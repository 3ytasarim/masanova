/**
 * Sadakat — saf hesaplar. Bakiye DEFTERDEN türetilir (istemci bakiyesine güvenilmez). Puan politikası UYDURULMAZ:
 * işletme "1 puan = X sipariş tutarı" kuralını belirleyene kadar (minorPerPoint null) kazanım yoktur.
 */
export type LedgerLike = { type: "EARN" | "REDEEM" | "ADJUSTMENT" | "EXPIRE" | "REVERSAL"; points: number; createdAt: Date };
export type LoyaltySettingsLike = { enabled: boolean; minorPerPoint: number | null; earnOn: "ACCEPTED" | "SERVED" };

/** Siparişin kazandıracağı puan (aşağı yuvarlanır; 0 → kayıt yok). */
export function pointsForOrder(totalMinor: number, minorPerPoint: number | null): number {
  if (!minorPerPoint || minorPerPoint <= 0 || !Number.isFinite(totalMinor) || totalMinor <= 0) return 0;
  return Math.floor(totalMinor / minorPerPoint);
}

/**
 * Bu durum geçişi puan kazandırır mı? Merkezi kural: varsayılan SERVED (servis edildiğinde). SUBMITTED, REJECTED,
 * CANCELLED hiçbir zaman kazandırmaz.
 */
export function earnsOnTransition(settings: LoyaltySettingsLike | null, to: string): boolean {
  if (!settings?.enabled || !settings.minorPerPoint) return false;
  return to === settings.earnOn;
}

export function ledgerSummary(entries: readonly LedgerLike[]): { balance: number; totalEarned: number; lastActivity: Date | null } {
  let balance = 0;
  let totalEarned = 0;
  let last: Date | null = null;
  for (const e of entries) {
    balance += e.points;
    if (e.type === "EARN") totalEarned += e.points;
    if (!last || e.createdAt > last) last = e.createdAt;
  }
  return { balance, totalEarned, lastActivity: last };
}

/** "Tekrar gelen müşteri" tanımı (deterministik): en az 2 SERVİS EDİLMİŞ siparişi olan müşteri. */
export const REPEAT_CUSTOMER_MIN_SERVED = 2;
export function isRepeatCustomer(servedOrders: number): boolean {
  return servedOrders >= REPEAT_CUSTOMER_MIN_SERVED;
}

/** Manuel düzeltme sınırı (yanlışlıkla devasa değer girilmesin). */
export const MAX_ADJUSTMENT = 100_000;
