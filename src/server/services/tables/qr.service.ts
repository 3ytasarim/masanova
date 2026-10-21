import "server-only";
import type { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { issueQrToken, rederiveQrToken } from "@/lib/tables/qr-token";
import type { TenantScope } from "@/lib/tenant/scope";
import { buildDirectQrUrl, buildQrUrl, getQrHostname, getQrSecret, tablesAudit, type TablesActor } from "@/server/services/tables/tables-common";

/**
 * Masa QR token yaşam döngüsü: oluştur → (yenile | iptal et). Kurallar:
 * - Bir masada en fazla bir etkin token (masa satırı FOR UPDATE ile kilitlenir; eşzamanlı yenileme sıraya girer).
 * - Yenileme: eski token aynı transaction'da iptal edilir → eski adres ANINDA çalışmaz; yeni satır oluşturulur.
 * - İptal edilen token asla yeniden etkinleşmez (geçmiş satırlar denetim için korunur).
 * - Düz token hiçbir yerde saklanmaz/loglanmaz; denetim kaydına yalnızca token satır kimliği yazılır.
 */

type Tx = Prisma.TransactionClient;

async function lockTable(tx: Tx, tenantId: string, tableId: string) {
  const rows = await tx.$queryRaw<{ id: string; branch_id: string; name: string }[]>`
    SELECT id, branch_id, name FROM dining_tables WHERE id = ${tableId} AND tenant_id = ${tenantId} FOR UPDATE`;
  return rows[0] ?? null;
}

async function insertToken(tx: Tx, tenantId: string, branchId: string, tableId: string) {
  const issued = issueQrToken(getQrSecret());
  return tx.tableQrToken.create({ data: { tenantId, branchId, tableId, tokenHash: issued.tokenHash, tokenNonce: issued.nonce }, select: { id: true } });
}

const NOT_FOUND = { ok: false as const, error: "Masa bulunamadı." };

export async function createTableQr(actor: TablesActor, tableId: string): Promise<ActionResult<{ id: string }>> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const table = await lockTable(tx, tenantId, tableId);
    if (!table) return NOT_FOUND;
    const active = await tx.tableQrToken.count({ where: { tenantId, tableId, active: true } });
    if (active > 0) return { ok: false as const, error: "Bu masanın zaten etkin bir QR kodu var. Yeni kod için 'QR'ı yenile'yi kullanın." };
    const token = await insertToken(tx, tenantId, table.branch_id, tableId);
    await tx.auditLog.create({ data: tablesAudit(actor, { action: "TABLE_QR_CREATED", entity: "TableQrToken", entityId: token.id, metadata: { tableId, table: table.name } }) });
    return { ok: true as const, data: token, message: "QR kodu oluşturuldu." };
  });
}

export async function regenerateTableQr(actor: TablesActor, tableId: string): Promise<ActionResult<{ id: string }>> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const table = await lockTable(tx, tenantId, tableId);
    if (!table) return NOT_FOUND;
    const revoked = await tx.tableQrToken.updateMany({ where: { tenantId, tableId, active: true }, data: { active: false, revokedAt: new Date() } });
    const token = await insertToken(tx, tenantId, table.branch_id, tableId);
    await tx.auditLog.create({
      data: tablesAudit(actor, { action: "TABLE_QR_REGENERATED", entity: "TableQrToken", entityId: token.id, metadata: { tableId, table: table.name, revokedCount: revoked.count } }),
    });
    return { ok: true as const, data: token, message: "QR kodu yenilendi. Eski QR artık çalışmıyor — yeni etiketi basın." };
  });
}

export async function revokeTableQr(actor: TablesActor, tableId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const table = await lockTable(tx, tenantId, tableId);
    if (!table) return NOT_FOUND;
    const revoked = await tx.tableQrToken.updateMany({ where: { tenantId, tableId, active: true }, data: { active: false, revokedAt: new Date() } });
    if (revoked.count === 0) return { ok: false as const, error: "Bu masanın etkin bir QR kodu yok." };
    await tx.auditLog.create({ data: tablesAudit(actor, { action: "TABLE_QR_REVOKED", entity: "DiningTable", entityId: tableId, metadata: { table: table.name, revokedCount: revoked.count } }) });
    return { ok: true as const, data: undefined, message: "QR kodu iptal edildi. Bu masanın QR adresi artık çalışmıyor." };
  });
}

/** Seçili masalardan etkin QR'ı olmayanlara QR üretir (toplu baskı öncesi). Kapsam dışı kimlikler yok sayılır. */
export async function ensureTablesHaveQr(actor: TablesActor, tableIds: string[]): Promise<ActionResult<{ created: number }>> {
  const tenantId = actor.scope.tenantId;
  const missing = await prisma.diningTable.findMany({
    where: { tenantId, id: { in: tableIds }, qrTokens: { none: { active: true } } },
    select: { id: true, branchId: true, name: true },
  });
  if (missing.length === 0) return { ok: true, data: { created: 0 }, message: "Tüm seçili masaların QR kodu var." };
  const secret = getQrSecret();
  await prisma.$transaction(
    async (tx) => {
      for (const table of missing) {
        if (!(await lockTable(tx, tenantId, table.id))) continue;
        if ((await tx.tableQrToken.count({ where: { tenantId, tableId: table.id, active: true } })) > 0) continue;
        const issued = issueQrToken(secret);
        const token = await tx.tableQrToken.create({ data: { tenantId, branchId: table.branchId, tableId: table.id, tokenHash: issued.tokenHash, tokenNonce: issued.nonce }, select: { id: true } });
        await tx.auditLog.create({ data: tablesAudit(actor, { action: "TABLE_QR_CREATED", entity: "TableQrToken", entityId: token.id, metadata: { tableId: table.id, table: table.name, bulk: true } }) });
      }
    },
    { timeout: 30_000 },
  );
  return { ok: true, data: { created: missing.length }, message: `${missing.length} masaya QR kodu oluşturuldu.` };
}

/** url: basılı QR'ın kodladığı kararlı adres; directUrl: kiracının o anki alan adındaki doğrudan adres (yoksa null). */
export type RevealedQr = { url: string; directUrl: string | null; tokenRowId: string; createdAt: Date };
export type RevealResult = { ok: true; qr: RevealedQr } | { ok: false; reason: "no_table" | "no_active_qr" | "no_domain" | "secret_mismatch" };

/**
 * Etkin QR'ın kararlı public adresi (yalnızca yetkili sunucu kodu; tablo yönetim yetkisi olan kullanıcıya gösterilir).
 * Token saklanan nonce'tan türetilir ve özetle doğrulanır — sır değişmişse yanlış QR üretilmez.
 */
export async function revealTableQr(scope: TenantScope, tableId: string): Promise<RevealResult> {
  const table = await prisma.diningTable.findFirst({
    where: { id: tableId, tenantId: scope.tenantId },
    select: { qrTokens: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, tokenNonce: true, tokenHash: true, createdAt: true } } },
  });
  if (!table) return { ok: false, reason: "no_table" };
  const row = table.qrTokens[0];
  if (!row) return { ok: false, reason: "no_active_qr" };
  const token = rederiveQrToken(getQrSecret(), row.tokenNonce, row.tokenHash);
  if (!token) return { ok: false, reason: "secret_mismatch" };
  const hostname = await getQrHostname(scope);
  return { ok: true, qr: { url: buildQrUrl(token), directUrl: hostname ? buildDirectQrUrl(hostname, token) : null, tokenRowId: row.id, createdAt: row.createdAt } };
}

/** Birden çok masanın adresi (toplu baskı) — tek alan adı sorgusu. */
export async function revealTablesQr(scope: TenantScope, tableIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const secret = getQrSecret();
  const rows = await prisma.tableQrToken.findMany({
    where: { tenantId: scope.tenantId, tableId: { in: tableIds }, active: true },
    orderBy: { createdAt: "desc" },
    select: { tableId: true, tokenNonce: true, tokenHash: true },
  });
  for (const row of rows) {
    if (out.has(row.tableId)) continue;
    const token = rederiveQrToken(secret, row.tokenNonce, row.tokenHash);
    if (token) out.set(row.tableId, buildQrUrl(token));
  }
  return out;
}

export const REVEAL_FAILURE_MESSAGES: Record<Exclude<RevealResult, { ok: true }>["reason"], string> = {
  no_table: "Masa bulunamadı.",
  no_active_qr: "Bu masanın etkin bir QR kodu yok. Önce QR oluşturun.",
  no_domain: "İşletmenin yayında bir alan adı yok; QR adresi üretilemiyor.",
  secret_mismatch: "Bu QR kodu yeniden üretilemiyor (sunucu QR anahtarı değişmiş). QR'ı yenileyip yeni etiket basın.",
};
