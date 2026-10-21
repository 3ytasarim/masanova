/**
 * Onay durumu — ekleme-yalnız kayıtlardan türetilir (güncel = türün EN SON satırı). Operasyonel iletişim (aktif
 * siparişin durumu) pazarlama onayı DEĞİLDİR: sipariş akışı hiçbir pazarlama onayı üretmez.
 */
export type ConsentKind = "PRIVACY" | "LOYALTY" | "MARKETING_EMAIL" | "MARKETING_SMS" | "MARKETING_WHATSAPP";
export type ConsentRowLike = { type: ConsentKind; status: "GRANTED" | "REVOKED"; createdAt: Date; version: string };
/** Panel gösterimi: İzin var / İzin yok (hiç verilmedi) / Geri alındı */
export type ConsentState = "GRANTED" | "NONE" | "REVOKED";

export const CONSENT_KINDS: readonly ConsentKind[] = ["PRIVACY", "LOYALTY", "MARKETING_EMAIL", "MARKETING_SMS", "MARKETING_WHATSAPP"];

export function currentConsents(rows: readonly ConsentRowLike[]): Record<ConsentKind, { state: ConsentState; since: Date | null; version: string | null }> {
  const out = Object.fromEntries(CONSENT_KINDS.map((k) => [k, { state: "NONE" as ConsentState, since: null as Date | null, version: null as string | null }])) as Record<ConsentKind, { state: ConsentState; since: Date | null; version: string | null }>;
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const r of sorted) out[r.type] = { state: r.status === "GRANTED" ? "GRANTED" : "REVOKED", since: r.createdAt, version: r.version };
  return out;
}

/**
 * İstenen değişim yeni kayıt gerektiriyor mu? Aynı durumu tekrar yazmak (ör. zaten verilmiş onayı yeniden vermek)
 * kayıt üretmez; hiç verilmemiş onay "geri alınamaz" (anlamsız kayıt yok).
 */
export function consentTransition(current: ConsentState, wanted: "GRANTED" | "REVOKED"): "insert" | "noop" {
  if (wanted === "GRANTED") return current === "GRANTED" ? "noop" : "insert";
  return current === "GRANTED" ? "insert" : "noop";
}

export const CONSENT_STATE_LABELS: Record<ConsentState, string> = { GRANTED: "İzin var", NONE: "İzin yok", REVOKED: "Geri alındı" };
