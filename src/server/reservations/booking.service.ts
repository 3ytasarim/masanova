import "server-only";
import { Prisma, type ReservationSource, type ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import type { AuditAction } from "@/lib/audit/actions";
import { blackoutHit, candidateAssignments, maxSeatable, occupancy, withinOpeningHours, type Assignment } from "@/lib/reservations/availability";
import { canCustomerCancel, canMarkNoShow, canTransition, isActiveStatus, type ReservationStatusName } from "@/lib/reservations/status";
import { deriveManageToken, hashIdempotency, hashManageToken, isManageTokenFormat, newManageNonce, newReservationPublicId, policyViolation, type PolicyViolation } from "@/lib/reservations/rules";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { getPolicy, loadBlackouts, loadBranchContext, loadBusy } from "@/server/reservations/context";
import { queueReservationNotification } from "@/server/reservations/notifications";
import { buildAuditRow } from "@/server/services/audit.service";
import { checkFeature } from "@/server/billing/entitlements";

/**
 * Rezervasyon yazımları. ÇİFT REZERVASYON engeli üç katmandır:
 *   1. Şube kilidi: pg_advisory_xact_lock(şube) — aynı şubedeki oluşturma / masa değiştirme işlemleri sıraya girer.
 *   2. Kilit altında uygunluk YENİDEN hesaplanır (tarayıcı / önbellek uygunluğuna güvenilmez).
 *   3. Veritabanı: reservation_tables EXCLUDE (gist) — kod hatası olsa bile çakışan etkin satır yazılamaz.
 * Tarayıcı masa kimliği seçemez; public akışta masa motor tarafından atanır.
 */
type Tx = Prisma.TransactionClient;
const NO_META: RequestMeta = { ipAddress: null, userAgent: null };

export type StaffActor = { scope: TenantScope; userId: string; meta: RequestMeta; canOverride: boolean };

export type BookingInput = {
  branchId: string;
  startsAt: Date;
  partySize: number;
  durationMinutes?: number | null;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  preferredAreaId: string | null;
  specialRequest: string | null;
  internalNote?: string | null;
  source: ReservationSource;
  customerId: string | null;
  locale: string;
  /** Personel belirli masa(lar) seçebilir — yine çakışma ve kapasite denetiminden geçer. */
  tableIds?: string[] | null;
  walkIn?: boolean;
  idempotencyKey?: string | null;
  requestHash?: string | null;
};

export type BookingFailure =
  | PolicyViolation
  | "disabled"
  | "branch_invalid"
  | "area_invalid"
  | "closed"
  | "blackout"
  | "no_table"
  | "tables_invalid"
  | "idempotency_conflict";

export type BookingResult =
  | { ok: true; replay: boolean; reservation: { id: string; publicId: string; status: ReservationStatus; startsAt: Date; endsAt: Date; tableNames: string[] }; manageToken: string }
  | { ok: false; reason: BookingFailure; maxSeatable?: number };

class Fail extends Error {
  constructor(
    readonly reason: BookingFailure,
    readonly maxSeatable?: number,
  ) {
    super(reason);
  }
}

export async function lockBranch(tx: Tx, branchId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation-branch:${branchId}`}, 0))::text AS locked`;
}

export function isOverlapViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("reservation_tables_no_overlap") || text.includes("23P01");
}

function audit(tx: Tx, action: AuditAction, tenantId: string, reservationId: string, userId: string | null, meta: RequestMeta, metadata: Record<string, unknown>) {
  return tx.auditLog.create({ data: buildAuditRow({ action, entity: "Reservation", entityId: reservationId, tenantId, userId, metadata }, meta) });
}

const secret = () => getServerEnv().QR_TOKEN_SECRET;

async function replay(tenantId: string, key: string, requestHash: string | null): Promise<BookingResult | null> {
  const existing = await prisma.reservation.findUnique({
    where: { tenantId_idempotencyKeyHash: { tenantId, idempotencyKeyHash: hashIdempotency(key) } },
    select: { id: true, publicId: true, status: true, startsAt: true, endsAt: true, requestHash: true, manageTokenNonce: true, tables: { select: { table: { select: { name: true } } } } },
  });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) return { ok: false, reason: "idempotency_conflict" };
  return {
    ok: true,
    replay: true,
    reservation: { id: existing.id, publicId: existing.publicId, status: existing.status, startsAt: existing.startsAt, endsAt: existing.endsAt, tableNames: existing.tables.map((t) => t.table.name) },
    manageToken: deriveManageToken(secret(), existing.manageTokenNonce),
  };
}

/**
 * Rezervasyon / walk-in oluşturma. `actor` yoksa public (müşteri) kanalıdır: tüm kurallar uygulanır, masa motor seçer.
 * Personel `override` (yalnız sahip / müdür) ile ZAMAN / SAAT / KAPALI DÖNEM / KİŞİ / KAPASİTE kurallarını aşabilir —
 * masa çakışmasını ASLA (veritabanı). Aşma denetim kaydına RESERVATION_OVERRIDE olarak yazılır.
 */
export async function createReservation(tenantId: string, input: BookingInput, actor: StaffActor | null, opts: { override?: boolean; now?: Date } = {}): Promise<BookingResult> {
  const now = opts.now ?? new Date();
  const policy = await getPolicy(tenantId);
  const channel = actor ? "staff" : "public";
  const override = !!(actor && actor.canOverride && opts.override);
  // Public kanal masa SEÇEMEZ ve walk-in oluşturamaz (tarayıcı alanları yok sayılır; masa motor tarafından atanır).
  const explicitTables = actor ? (input.tableIds ?? null) : null;
  const walkIn = !!(actor && input.walkIn);
  if (!policy.enabled || (channel === "public" && !policy.publicBookingEnabled)) return { ok: false, reason: "disabled" };
  // Paket kapısı (Sprint 20): YENİ rezervasyon yetki ister; mevcut rezervasyonlar paket düşse de yönetilir / iptal edilir.
  if (!(await checkFeature(tenantId, "reservations")).allowed) return { ok: false, reason: "disabled" };
  if (input.idempotencyKey) {
    const previous = await replay(tenantId, input.idempotencyKey, input.requestHash ?? null);
    if (previous) return previous;
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockBranch(tx, input.branchId);
        const ctx = await loadBranchContext(tenantId, input.branchId, tx);
        if (!ctx) throw new Fail("branch_invalid");
        if (input.preferredAreaId && !ctx.areas.some((a) => a.id === input.preferredAreaId)) throw new Fail("area_invalid");

        const duration = channel === "public" ? policy.defaultDurationMinutes : (input.durationMinutes ?? policy.defaultDurationMinutes);
        const block = occupancy(input.startsAt, duration, policy.bufferMinutes);
        const bypassed: string[] = [];
        if (!walkIn) {
          const violation = policyViolation(policy, { startsAt: input.startsAt, partySize: input.partySize, now, channel });
          if (violation) {
            if (!override) throw new Fail(violation, violation === "party_too_large" ? Math.min(policy.maxPartySize, maxSeatable(ctx.tables, ctx.combinations)) : undefined);
            bypassed.push(violation);
          }
          if (!withinOpeningHours(input.startsAt, duration, ctx.branch.timeZone, ctx.hoursByWeekday)) {
            if (!override) throw new Fail("closed");
            bypassed.push("closed");
          }
          if (blackoutHit({ start: block.start, end: block.start + duration * 60_000 }, await loadBlackouts(tenantId, input.branchId, block, tx))) {
            if (!override) throw new Fail("blackout");
            bypassed.push("blackout");
          }
        }

        const busy = await loadBusy(tenantId, input.branchId, block, tx);
        let assignment: Assignment | null;
        if (explicitTables?.length) {
          const chosen = explicitTables.map((id) => ctx.tables.find((t) => t.id === id));
          if (chosen.some((t) => !t) || new Set(explicitTables).size !== explicitTables.length) throw new Fail("tables_invalid");
          if (chosen.some((t) => busy.some((b) => b.tableId === t!.id && b.start < block.end && block.start < b.end))) throw new Fail("no_table");
          const capacity = chosen.reduce((s, t) => s + (t!.capacity ?? 0), 0);
          if (capacity < input.partySize || chosen.some((t) => !t!.reservable)) {
            if (!override) throw new Fail("tables_invalid");
            bypassed.push("capacity");
          }
          assignment = { tableIds: chosen.map((t) => t!.id), capacity, combinationId: null, label: chosen.map((t) => t!.name).join(" + "), areaMatch: true };
        } else {
          assignment = candidateAssignments({ tables: ctx.tables, combinations: ctx.combinations, busy, block, partySize: input.partySize, preferredAreaId: input.preferredAreaId })[0] ?? null;
        }
        if (!assignment) throw new Fail("no_table", maxSeatable(ctx.tables, ctx.combinations));

        const status: ReservationStatus = walkIn ? "SEATED" : channel === "staff" || policy.autoConfirm ? "CONFIRMED" : "PENDING";
        const nonce = newManageNonce();
        const token = deriveManageToken(secret(), nonce);
        const reservation = await tx.reservation.create({
          data: {
            tenantId,
            branchId: input.branchId,
            publicId: newReservationPublicId(),
            manageTokenHash: hashManageToken(token),
            manageTokenNonce: nonce,
            customerId: input.customerId,
            guestName: input.guestName,
            guestPhone: input.guestPhone,
            guestPhoneNormalized: input.guestPhone,
            guestEmail: input.guestEmail,
            partySize: input.partySize,
            startsAt: input.startsAt,
            endsAt: new Date(input.startsAt.getTime() + duration * 60_000),
            durationMinutes: duration,
            bufferMinutes: policy.bufferMinutes,
            status,
            source: input.source,
            preferredAreaId: input.preferredAreaId,
            specialRequest: input.specialRequest,
            internalNote: input.internalNote ?? null,
            overridden: bypassed.length > 0,
            locale: input.locale,
            idempotencyKeyHash: input.idempotencyKey ? hashIdempotency(input.idempotencyKey) : null,
            requestHash: input.requestHash ?? null,
            createdByUserId: actor?.userId ?? null,
            confirmedAt: status === "CONFIRMED" || status === "SEATED" ? now : null,
            seatedAt: status === "SEATED" ? now : null,
          },
          select: { id: true, publicId: true, status: true, startsAt: true, endsAt: true },
        });
        await tx.reservationTable.createMany({
          data: assignment.tableIds.map((tableId) => ({ tenantId, branchId: input.branchId, reservationId: reservation.id, tableId, startsAt: new Date(block.start), blockedUntil: new Date(block.end), active: true })),
        });
        await tx.reservationStatusHistory.create({ data: { tenantId, reservationId: reservation.id, fromStatus: null, toStatus: status, actorType: actor ? "STAFF" : "CUSTOMER", actorUserId: actor?.userId ?? null } });
        const meta = actor?.meta ?? NO_META;
        const base = { source: input.source, branchId: input.branchId, partySize: input.partySize, tables: assignment.tableIds.length, identified: !!input.customerId };
        await audit(tx, "RESERVATION_CREATED", tenantId, reservation.id, actor?.userId ?? null, meta, { ...base, status, actor: actor ? "staff" : "customer" });
        await audit(tx, "RESERVATION_TABLE_ASSIGNED", tenantId, reservation.id, actor?.userId ?? null, meta, { tables: assignment.tableIds, combination: assignment.combinationId, automatic: !explicitTables?.length });
        if (status === "SEATED") await audit(tx, "RESERVATION_SEATED", tenantId, reservation.id, actor?.userId ?? null, meta, { walkIn: true });
        else if (status === "CONFIRMED") await audit(tx, "RESERVATION_CONFIRMED", tenantId, reservation.id, actor?.userId ?? null, meta, { automatic: true });
        if (bypassed.length) await audit(tx, "RESERVATION_OVERRIDE", tenantId, reservation.id, actor?.userId ?? null, meta, { bypassed });
        const tableNames = assignment.tableIds.map((id) => ctx.tables.find((t) => t.id === id)!.name);
        return { ok: true as const, replay: false, reservation: { ...reservation, tableNames }, manageToken: token };
      },
      { timeout: 15_000 },
    );
    if (result.reservation.status === "CONFIRMED") queueReservationNotification("RESERVATION_CONFIRMED", tenantId, result.reservation.id);
    return result;
  } catch (error) {
    if (error instanceof Fail) return { ok: false, reason: error.reason, ...(error.maxSeatable !== undefined ? { maxSeatable: error.maxSeatable } : {}) };
    if (isOverlapViolation(error)) return { ok: false, reason: "no_table" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.idempotencyKey) {
      const again = await replay(tenantId, input.idempotencyKey, input.requestHash ?? null);
      if (again) return again;
    }
    throw error;
  }
}

// ─── Durum geçişleri ────────────────────────────────────────────────────────

const AUDIT_FOR: Partial<Record<ReservationStatusName, AuditAction>> = {
  CONFIRMED: "RESERVATION_CONFIRMED",
  SEATED: "RESERVATION_SEATED",
  COMPLETED: "RESERVATION_COMPLETED",
  CANCELLED: "RESERVATION_CANCELLED",
  NO_SHOW: "RESERVATION_NO_SHOW",
};
const STAMP: Partial<Record<ReservationStatusName, "confirmedAt" | "seatedAt" | "completedAt" | "cancelledAt" | "noShowAt">> = {
  CONFIRMED: "confirmedAt",
  SEATED: "seatedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
  NO_SHOW: "noShowAt",
};

export type TransitionResult = { ok: true } | { ok: false; reason: "not_found" | "invalid_transition" | "too_early" | "conflict" | "cutoff" };

async function applyTransition(
  tx: Tx,
  input: { tenantId: string; id: string; from: ReservationStatusName; to: ReservationStatusName; now: Date; actorType: "STAFF" | "CUSTOMER"; userId: string | null; meta: RequestMeta; reason?: string | null },
): Promise<boolean> {
  const { tenantId, id, from, to, now } = input;
  const stamp = STAMP[to];
  const updated = await tx.reservation.updateMany({
    where: { id, tenantId, status: from },
    data: { status: to, ...(stamp ? { [stamp]: now } : {}), ...(to === "CANCELLED" ? { cancelledBy: input.actorType } : {}) },
  });
  if (updated.count !== 1) return false;
  // Son durum: masalar serbest kalır (satırlar geçmiş için saklanır).
  if (!isActiveStatus(to)) await tx.reservationTable.updateMany({ where: { tenantId, reservationId: id }, data: { active: false } });
  await tx.reservationStatusHistory.create({ data: { tenantId, reservationId: id, fromStatus: from, toStatus: to, actorType: input.actorType, actorUserId: input.userId, reason: input.reason ?? null, createdAt: now } });
  const action = AUDIT_FOR[to];
  if (action) await audit(tx, action, tenantId, id, input.userId, input.meta, { from, to, actor: input.actorType.toLowerCase(), reason: input.reason ?? null });
  return true;
}

export async function transitionReservation(actor: StaffActor, id: string, to: ReservationStatusName, opts: { reason?: string | null; now?: Date } = {}): Promise<TransitionResult> {
  const tenantId = actor.scope.tenantId;
  const now = opts.now ?? new Date();
  const r = await prisma.reservation.findFirst({ where: { id, tenantId }, select: { status: true, startsAt: true } });
  if (!r) return { ok: false, reason: "not_found" };
  if (!canTransition(r.status, to)) return { ok: false, reason: "invalid_transition" };
  if (to === "NO_SHOW") {
    const policy = await getPolicy(tenantId);
    if (!canMarkNoShow(r, now, policy.noShowGraceMinutes)) return { ok: false, reason: "too_early" };
  }
  const applied = await prisma.$transaction((tx) => applyTransition(tx, { tenantId, id, from: r.status, to, now, actorType: "STAFF", userId: actor.userId, meta: actor.meta, reason: opts.reason }));
  if (!applied) return { ok: false, reason: "conflict" };
  if (to === "CONFIRMED") queueReservationNotification("RESERVATION_CONFIRMED", tenantId, id);
  return { ok: true };
}

/** Masa değiştirme (sahip / müdür). `tableIds` boşsa motor en uygun masayı seçer. Kendi eski bloğu hariç tutulur. */
export async function reassignTables(actor: StaffActor, id: string, tableIds: string[] | null, opts: { override?: boolean } = {}): Promise<{ ok: true; tableNames: string[] } | { ok: false; reason: "not_found" | "not_active" | "no_table" | "tables_invalid" }> {
  const tenantId = actor.scope.tenantId;
  const override = actor.canOverride && !!opts.override;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const r = await tx.reservation.findFirst({ where: { id, tenantId }, select: { branchId: true, status: true, startsAt: true, durationMinutes: true, bufferMinutes: true, partySize: true, preferredAreaId: true } });
        if (!r) return { ok: false as const, reason: "not_found" as const };
        if (!isActiveStatus(r.status)) return { ok: false as const, reason: "not_active" as const };
        await lockBranch(tx, r.branchId);
        const ctx = (await loadBranchContext(tenantId, r.branchId, tx))!;
        const block = occupancy(r.startsAt, r.durationMinutes, r.bufferMinutes);
        const busy = await loadBusy(tenantId, r.branchId, block, tx, id);
        let chosen: string[];
        let bypassed = false;
        if (tableIds?.length) {
          const tables = tableIds.map((t) => ctx.tables.find((x) => x.id === t));
          if (tables.some((t) => !t) || new Set(tableIds).size !== tableIds.length) return { ok: false as const, reason: "tables_invalid" as const };
          if (tables.some((t) => busy.some((b) => b.tableId === t!.id && b.start < block.end && block.start < b.end))) return { ok: false as const, reason: "no_table" as const };
          const capacity = tables.reduce((s, t) => s + (t!.capacity ?? 0), 0);
          if (capacity < r.partySize || tables.some((t) => !t!.reservable)) {
            if (!override) return { ok: false as const, reason: "tables_invalid" as const };
            bypassed = true;
          }
          chosen = tableIds;
        } else {
          const best = candidateAssignments({ tables: ctx.tables, combinations: ctx.combinations, busy, block, partySize: r.partySize, preferredAreaId: r.preferredAreaId })[0];
          if (!best) return { ok: false as const, reason: "no_table" as const };
          chosen = best.tableIds;
        }
        await tx.reservationTable.deleteMany({ where: { tenantId, reservationId: id } });
        await tx.reservationTable.createMany({ data: chosen.map((tableId) => ({ tenantId, branchId: r.branchId, reservationId: id, tableId, startsAt: new Date(block.start), blockedUntil: new Date(block.end), active: true })) });
        await audit(tx, "RESERVATION_TABLE_ASSIGNED", tenantId, id, actor.userId, actor.meta, { tables: chosen, automatic: !tableIds?.length, reassigned: true });
        if (bypassed) await audit(tx, "RESERVATION_OVERRIDE", tenantId, id, actor.userId, actor.meta, { bypassed: ["capacity"] });
        return { ok: true as const, tableNames: chosen.map((t) => ctx.tables.find((x) => x.id === t)!.name) };
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (isOverlapViolation(error)) return { ok: false, reason: "no_table" };
    throw error;
  }
}

export async function updateInternalNote(actor: StaffActor, id: string, note: string | null): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const r = await tx.reservation.updateMany({ where: { id, tenantId }, data: { internalNote: note } });
    if (r.count !== 1) return false;
    await audit(tx, "RESERVATION_UPDATED", tenantId, id, actor.userId, actor.meta, { fields: ["internalNote"] });
    return true;
  });
}

// ─── Müşteri yönetim bağlantısı ─────────────────────────────────────────────

/** Belirteçle (kiracı + özet) rezervasyon. İç not, müşteri kimliği, oluşturan personel DÖNMEZ. */
export async function findByManageToken(tenantId: string, token: unknown) {
  if (!isManageTokenFormat(token)) return null;
  return prisma.reservation.findFirst({
    where: { tenantId, manageTokenHash: hashManageToken(token) },
    select: {
      id: true,
      publicId: true,
      status: true,
      guestName: true,
      partySize: true,
      startsAt: true,
      endsAt: true,
      specialRequest: true,
      locale: true,
      branch: { select: { name: true, timezone: true, address: true, phone: true } },
      preferredArea: { select: { name: true } },
    },
  });
}

export async function cancelByManageToken(tenantId: string, token: unknown, now = new Date()): Promise<TransitionResult> {
  const r = await findByManageToken(tenantId, token);
  if (!r) return { ok: false, reason: "not_found" };
  const policy = await getPolicy(tenantId);
  if (!canCustomerCancel(r, now, policy.cancellationCutoffMinutes)) return { ok: false, reason: r.status === "PENDING" || r.status === "CONFIRMED" ? "cutoff" : "invalid_transition" };
  const applied = await prisma.$transaction((tx) => applyTransition(tx, { tenantId, id: r.id, from: r.status, to: "CANCELLED", now, actorType: "CUSTOMER", userId: null, meta: NO_META, reason: "customer" }));
  return applied ? { ok: true } : { ok: false, reason: "conflict" };
}
