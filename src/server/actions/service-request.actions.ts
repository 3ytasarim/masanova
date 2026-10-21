"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { sanitizeNote } from "@/lib/orders/notes";
import { rateLimitAll } from "@/server/rate-limit";
import { metrics } from "@/lib/observability/metrics";
import { getRequestMeta } from "@/lib/security/request-meta";
import { serviceAbilities } from "@/lib/service-requests/status";
import { SERVICE_NOTE_MAX, SERVICE_PUBLIC_ID, SERVICE_REQUEST_TYPES, staffDisplayName } from "@/lib/service-requests/types";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import {
  cancelCustomerRequest,
  listCustomerRequests,
  submitServiceRequest,
  type CustomerServiceRequestView,
  type ServiceRequestContext,
  type SubmitServiceResult,
} from "@/server/services/service-requests/customer-request.service";
import { readCustomerIdentity } from "@/server/crm/customer-session";
import { activeCustomerId } from "@/server/crm/customer.service";
import { cancelServiceRequestByStaff, claimServiceRequest, completeServiceRequest, type ServiceStaffActor } from "@/server/services/service-requests/staff-request.service";

/**
 * Servis talebi eylemleri.
 *
 * Müşteri (public, kiracı alan adı, oturum yok): masa bağlamı her çağrıda QR token + istek host'undan yeniden kurulur
 * (getTableQrContext). İptal / pasif QR, masa, bölge, şube ya da askıdaki kiracı → nötr "context_invalid".
 * Hız sınırı katmanlı: masa + tip, masa, IP (ikincil; restoran Wi-Fi'si tek IP olabilir). Politikalar: src/server/rate-limit/policies.ts (REDIS_URL varsa süreçler arası paylaşılır).
 *
 * Personel: requireTenantUser({ permission: "service.view", write: true }) — destek modu ve mutfak / bar reddedilir;
 * tip / üstlenen / yönetici kuralları servis katmanında (serviceAbilities + status.ts) uygulanır.
 */

export type PublicServiceResult = SubmitServiceResult | { kind: "rejected"; reason: "context_invalid" | "invalid" | "rate_limited" };
export type PublicServiceList = { kind: "ok"; requests: CustomerServiceRequestView[] } | { kind: "rejected"; reason: "context_invalid" };

async function serviceContext(token: unknown): Promise<ServiceRequestContext | null> {
  if (typeof token !== "string") return null;
  const result = await getTableQrContext(token);
  if (!result.ok) return null;
  const { context } = result;
  return {
    tenantId: context.tenant.id,
    branchId: context.branch.id,
    tableId: context.table.id,
    areaId: context.area?.id ?? null,
    tokenId: context.token.id,
    branchName: context.branch.name,
    areaName: context.area?.name ?? null,
    tableName: context.table.name,
  };
}

const submitSchema = z.object({
  type: z.enum(SERVICE_REQUEST_TYPES),
  note: z
    .string()
    .max(SERVICE_NOTE_MAX * 2)
    .nullish()
    .transform((v) => sanitizeNote(v ?? null, SERVICE_NOTE_MAX)),
  recentOrders: z.array(z.string().regex(SERVICE_PUBLIC_ID)).max(10).default([]),
});

export async function submitServiceRequestAction(token: string, payload: unknown): Promise<PublicServiceResult> {
  const ctx = await serviceContext(token);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  const parsed = submitSchema.safeParse(payload);
  if (!parsed.success) return { kind: "rejected", reason: "invalid" };
  const { type, note, recentOrders } = parsed.data;

  const ip = (await getRequestMeta()).ipAddress ?? "unknown";
  const limit = await rateLimitAll([
    ["service.tabletype", `${ctx.tableId}|${type}`],
    ["service.table", ctx.tableId],
    ["service.ip", ip],
  ]);
  if (!limit.allowed) return { kind: "rejected", reason: "rate_limited" };

  const identity = await readCustomerIdentity(ctx.tenantId);
  const customerId = identity ? await activeCustomerId(ctx.tenantId, identity.customerId) : null;
  const result = await submitServiceRequest({ ...ctx, customerId }, { type, note, recentOrderIds: recentOrders });
  if (result.kind === "created") {
    metrics.inc("service_requests.created");
    revalidatePath("/panel/servis", "layout");
  }
  return result;
}

export async function listServiceRequestsAction(token: string): Promise<PublicServiceList> {
  const ctx = await serviceContext(token);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  return { kind: "ok", requests: await listCustomerRequests(ctx) };
}

export async function cancelOwnServiceRequestAction(token: string, publicId: string): Promise<{ ok: boolean }> {
  const ctx = await serviceContext(token);
  if (!ctx || typeof publicId !== "string" || !SERVICE_PUBLIC_ID.test(publicId)) return { ok: false };
  const result = await cancelCustomerRequest(ctx, publicId);
  if (result.ok) revalidatePath("/panel/servis", "layout");
  return { ok: result.ok };
}

// ─── Personel ───────────────────────────────────────────────────────────────

async function staffActor(): Promise<ServiceStaffActor> {
  const ctx = await requireTenantUser({ permission: "service.view", write: true });
  return {
    userId: ctx.user.id,
    displayName: staffDisplayName(ctx.user.firstName, ctx.user.lastName),
    scope: ctx.scope,
    meta: await getRequestMeta(),
    abilities: serviceAbilities(ctx.user.role),
  };
}

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);
const op = z.enum(["claim", "complete", "cancel"]);

export async function serviceRequestStaffAction(requestId: string, operation: "claim" | "complete" | "cancel"): Promise<ActionResult> {
  const actor = await staffActor();
  if (!idSchema.safeParse(requestId).success || !op.safeParse(operation).success) return { ok: false, error: "Geçersiz işlem." };
  const result =
    operation === "claim" ? await claimServiceRequest(actor, requestId) : operation === "complete" ? await completeServiceRequest(actor, requestId) : await cancelServiceRequestByStaff(actor, requestId);
  revalidatePath("/panel/servis", "layout");
  return result;
}
