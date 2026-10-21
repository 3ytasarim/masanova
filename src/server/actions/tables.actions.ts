"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { getRequestMeta } from "@/lib/security/request-meta";
import { areaSchema, bulkTablesSchema, tableIdSchema, tableSchema } from "@/lib/validation/tables";
import { createArea, moveArea, setAreaActive, updateArea } from "@/server/services/tables/area.service";
import { createTableQr, ensureTablesHaveQr, regenerateTableQr, revokeTableQr } from "@/server/services/tables/qr.service";
import { bulkCreateTables, createTable, moveTable, moveTableToArea, setTableActive, updateTable } from "@/server/services/tables/table.service";
import type { TablesActor } from "@/server/services/tables/tables-common";

/**
 * Masa / bölge / QR eylemleri. Her eylem: requireTenantUser({ permission: "tables.manage", write: true }) —
 * yalnızca İşletme Sahibi / Şube Müdürü; garson/kasiyer (salt okunur), mutfak/bar ve Super Admin destek modu reddedilir.
 * Kiracı her zaman oturumdan; form/bağlı argümanlardaki kimlikler yalnızca kapsam İÇİNDE aranır.
 */
type FormState = ActionResult | null;

async function tablesActor(): Promise<TablesActor> {
  const ctx = await requireTenantUser({ permission: "tables.manage", write: true });
  return { userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() };
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

function done<T>(result: ActionResult<T>): ActionResult {
  revalidatePath("/panel/masalar", "layout");
  return result.ok ? { ok: true, data: undefined, message: result.message } : result;
}

const badId = { ok: false as const, error: "Kayıt bulunamadı." };

// ─── Bölgeler ───────────────────────────────────────────────────────────────

export async function saveAreaAction(branchId: string, areaId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  if (!tableIdSchema.safeParse(branchId).success || (areaId !== null && !tableIdSchema.safeParse(areaId).success)) return badId;
  const parsed = areaSchema.safeParse({ name: str(fd, "name"), slug: str(fd, "slug"), description: str(fd, "description"), active: bool(fd, "active") });
  if (!parsed.success) return invalid(parsed.error);
  return done(areaId ? await updateArea(actor, areaId, parsed.data) : await createArea(actor, branchId, parsed.data));
}

export async function areaQuickAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  const parsed = z
    .object({ id: tableIdSchema, op: z.enum(["active", "up", "down"]), value: z.enum(["true", "false"]).optional() })
    .safeParse({ id: str(fd, "id"), op: str(fd, "op"), value: str(fd, "value") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz işlem.");
  const { id, op, value } = parsed.data;
  return done(op === "active" ? await setAreaActive(actor, id, value === "true") : await moveArea(actor, id, op));
}

// ─── Masalar ────────────────────────────────────────────────────────────────

function tableFields(fd: FormData) {
  return tableSchema.safeParse({
    name: str(fd, "name"),
    number: str(fd, "number"),
    code: str(fd, "code"),
    capacity: str(fd, "capacity"),
    capacityMin: str(fd, "capacityMin"),
    // Rezervasyon alanı olmayan eski formlar masayı rezervasyondan düşürmesin.
    reservable: fd.has("reservablePresent") ? bool(fd, "reservable") : true,
    diningAreaId: str(fd, "diningAreaId"),
    active: bool(fd, "active"),
  });
}

export async function createTableAction(branchId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  if (!tableIdSchema.safeParse(branchId).success) return badId;
  const parsed = tableFields(fd);
  if (!parsed.success) return invalid(parsed.error);
  return done(await createTable(actor, branchId, parsed.data));
}

export async function updateTableAction(tableId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  if (!tableIdSchema.safeParse(tableId).success) return badId;
  const parsed = tableFields(fd);
  if (!parsed.success) return invalid(parsed.error);
  return done(await updateTable(actor, tableId, parsed.data));
}

export async function bulkCreateTablesAction(branchId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  if (!tableIdSchema.safeParse(branchId).success) return badId;
  const parsed = bulkTablesSchema.safeParse({
    diningAreaId: str(fd, "diningAreaId"),
    count: str(fd, "count"),
    startNumber: str(fd, "startNumber"),
    pattern: str(fd, "pattern"),
    capacity: str(fd, "capacity"),
  });
  if (!parsed.success) return invalid(parsed.error);
  return done(await bulkCreateTables(actor, branchId, { ...parsed.data, withQr: bool(fd, "withQr") }));
}

export async function tableQuickAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  const parsed = z
    .object({ id: tableIdSchema, op: z.enum(["active", "up", "down", "area"]), value: z.string().optional() })
    .safeParse({ id: str(fd, "id"), op: str(fd, "op"), value: str(fd, "value") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz işlem.");
  const { id, op, value } = parsed.data;
  if (op === "active") return done(await setTableActive(actor, id, value === "true"));
  if (op === "area") {
    const areaId = value ? tableIdSchema.safeParse(value) : null;
    if (areaId && !areaId.success) return badId;
    return done(await moveTableToArea(actor, id, areaId ? areaId.data : null));
  }
  return done(await moveTable(actor, id, op));
}

// ─── QR ─────────────────────────────────────────────────────────────────────

/** QR işlemleri (oluştur / yenile / iptal) — yenile ve iptal arayüzde onay penceresiyle tetiklenir. */
export async function tableQrAction(tableId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  if (!tableIdSchema.safeParse(tableId).success) return badId;
  const op = z.enum(["create", "regenerate", "revoke"]).safeParse(str(fd, "op"));
  if (!op.success) return { ok: false, error: "Geçersiz işlem." };
  const result = op.data === "create" ? await createTableQr(actor, tableId) : op.data === "regenerate" ? await regenerateTableQr(actor, tableId) : await revokeTableQr(actor, tableId);
  return done(result);
}

export async function ensureTablesQrAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await tablesActor();
  const parsed = z.array(tableIdSchema).min(1, "En az bir masa seçin.").max(1000).safeParse(fd.getAll("masalar"));
  if (!parsed.success) return invalid(parsed.error, "Geçersiz seçim.");
  return done(await ensureTablesHaveQr(actor, parsed.data));
}
