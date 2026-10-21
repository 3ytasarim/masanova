"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { getRequestMeta } from "@/lib/security/request-meta";
import { productStationsSchema, stationSchema } from "@/lib/validation/stations";
import { tableIdSchema } from "@/lib/validation/tables";
import { createStation, moveStation, setDefaultStation, setProductStations, setStationActive, updateStation, type StationActor } from "@/server/services/kds/station.service";
import { featureDenied } from "@/server/billing/action-gate";

/**
 * Hazırlama istasyonu eylemleri — requireTenantUser({ permission: "stations.manage", write: true }): yalnızca
 * İşletme Sahibi / Şube Müdürü. Mutfak / bar personeli KDS'i kullanır ama istasyon ayarlarını değiştiremez.
 */
type FormState = ActionResult | null;

async function stationActor(): Promise<StationActor> {
  const ctx = await requireTenantUser({ permission: "stations.manage", write: true });
  return { userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() };
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

function done<T>(result: ActionResult<T>): ActionResult {
  revalidatePath("/panel/mutfak", "layout");
  revalidatePath("/panel/menu", "layout");
  return result.ok ? { ok: true, data: undefined, message: result.message } : result;
}

const badId = { ok: false as const, error: "Kayıt bulunamadı." };

export async function saveStationAction(branchId: string, stationId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await stationActor();
  const gate = await featureDenied(actor.scope.tenantId, "preparation_stations");
  if (gate) return gate;
  if (!tableIdSchema.safeParse(branchId).success || (stationId !== null && !tableIdSchema.safeParse(stationId).success)) return badId;
  const parsed = stationSchema.safeParse({ name: str(fd, "name"), type: str(fd, "type"), active: bool(fd, "active") });
  if (!parsed.success) return invalid(parsed.error);
  const input = { ...parsed.data, isDefault: bool(fd, "isDefault") };
  return done(stationId ? await updateStation(actor, stationId, input) : await createStation(actor, branchId, input));
}

export async function stationQuickAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await stationActor();
  const gate = await featureDenied(actor.scope.tenantId, "preparation_stations");
  if (gate) return gate;
  const parsed = z
    .object({ id: tableIdSchema, op: z.enum(["active", "default", "up", "down"]), value: z.enum(["true", "false"]).optional() })
    .safeParse({ id: str(fd, "id"), op: str(fd, "op"), value: str(fd, "value") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz işlem.");
  const { id, op, value } = parsed.data;
  if (op === "active") return done(await setStationActive(actor, id, value === "true"));
  if (op === "default") return done(await setDefaultStation(actor, id));
  return done(await moveStation(actor, id, op));
}

/** Ürün editörü › İstasyonlar: bir şube için atamaları kaydeder. */
export async function saveProductStationsAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await stationActor();
  const gate = await featureDenied(actor.scope.tenantId, "preparation_stations");
  if (gate) return gate;
  if (!tableIdSchema.safeParse(productId).success) return badId;
  const parsed = productStationsSchema.safeParse({ branchId: str(fd, "branchId"), stationIds: fd.getAll("stationIds").filter((v) => typeof v === "string") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz seçim.");
  return done(await setProductStations(actor, productId, parsed.data.branchId, parsed.data.stationIds));
}
