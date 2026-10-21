import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isValidTimeZone } from "@/lib/analytics/time";
import { resolveRange, type RangeError, type ResolvedRange } from "@/lib/analytics/range";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Analitik kapsamı: kiracı OTURUMDAN (scope) gelir; tarayıcı kiracı kimliği gönderemez. Şube filtresi yalnızca bu
 * kiracının şubesi olabilir (başka kiracının şube kimliği → "branch_invalid"; sorgu hiç çalışmaz).
 * Saat dilimi: tek şube seçiliyse şubenin, tüm şubelerde işletmenin (TenantSettings.timezone) saat dilimi.
 * Para birimi: işletmenin varsayılan para birimi; farklı para birimli siparişler TOPLANMAZ (ayrı uyarı).
 * Kullanıcı → şube ataması henüz yok: yetkili her kullanıcı kiracının tüm şubelerini görür (mevcut görünürlük modeli).
 */
export type AnalyticsFilter = {
  tenantId: string;
  branchId: string | null;
  timeZone: string;
  currency: string;
  start: Date;
  end: Date;
};

export type BranchOption = { id: string; name: string };

export type AnalyticsContext = {
  range: ResolvedRange;
  filter: AnalyticsFilter;
  previousFilter: AnalyticsFilter;
  branches: BranchOption[];
  branchName: string | null;
};

export type ContextError = RangeError | "branch_invalid";

export async function resolveAnalyticsContext(
  scope: TenantScope,
  input: { range?: string | null; from?: string | null; to?: string | null; branch?: string | null },
  now: Date = new Date(),
): Promise<{ ok: true; context: AnalyticsContext } | { ok: false; error: ContextError; branches: BranchOption[] }> {
  const [settings, branches] = await Promise.all([
    prisma.tenantSettings.findUnique({ where: { tenantId: scope.tenantId }, select: { timezone: true, defaultCurrency: true } }),
    prisma.branch.findMany({ where: { tenantId: scope.tenantId }, select: { id: true, name: true, timezone: true }, orderBy: { name: "asc" } }),
  ]);
  const options = branches.map((b) => ({ id: b.id, name: b.name }));
  let branch: (typeof branches)[number] | null = null;
  if (input.branch) {
    branch = branches.find((b) => b.id === input.branch) ?? null;
    if (!branch) return { ok: false, error: "branch_invalid", branches: options };
  }
  const tzCandidate = branch?.timezone ?? settings?.timezone ?? "Europe/Istanbul";
  const timeZone = isValidTimeZone(tzCandidate) ? tzCandidate : "Europe/Istanbul";
  const resolved = resolveRange({ key: input.range, from: input.from, to: input.to }, timeZone, now);
  if (!resolved.ok) return { ok: false, error: resolved.error, branches: options };
  const range = resolved.range;
  const base = { tenantId: scope.tenantId, branchId: branch?.id ?? null, timeZone, currency: settings?.defaultCurrency ?? "TRY" };
  return {
    ok: true,
    context: {
      range,
      filter: { ...base, start: range.start, end: range.effectiveEnd },
      previousFilter: { ...base, start: range.previous.start, end: range.previous.end },
      branches: options,
      branchName: branch?.name ?? null,
    },
  };
}

// ─── SQL parçaları (YALNIZCA parametreli; kullanıcı değeri metne eklenmez) ─────

/** Sabit sütun adından (kod içi) yerel zaman ifadesi: UTC saklanan zaman → restoran saat dilimi. */
export function localTime(column: "o.created_at" | "r.created_at" | "c.created_at" | "t.created_at", timeZone: string): Prisma.Sql {
  return Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})`;
}

export function branchClause(alias: "o" | "r" | "c" | "t", branchId: string | null): Prisma.Sql {
  if (!branchId) return Prisma.empty;
  return Prisma.sql` AND ${Prisma.raw(`${alias}.branch_id`)} = ${branchId}`;
}

/** Satış sayılan sipariş koşulu (bkz. src/lib/analytics/metrics.ts › SALES_STATUSES). */
export const SALE = Prisma.sql`(o.accepted_at IS NOT NULL AND o.status IN ('ACCEPTED','PREPARING','READY','SERVED'))`;

/** BigInt / Decimal / null → number (kuruş toplamları güvenli tamsayı aralığında). */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Math.round(num(value));
}

/** Analitiğin "şimdi"si — 30 sn'ye yuvarlanır: devam eden dönemin sonu ve önbellek anahtarı kararlı olur. */
export function analyticsNow(granularityMs = 30_000): Date {
  return new Date(Math.floor(Date.now() / granularityMs) * granularityMs);
}
