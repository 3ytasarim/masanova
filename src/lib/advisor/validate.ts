import { fmtMetric } from "@/lib/advisor/format";
import type { RenderedInsight } from "@/lib/advisor/templates";
import type { InsightCandidate } from "@/lib/advisor/types";

/**
 * AI açıklaması doğrulaması — AI yalnızca deterministik olguları DİLE döker. Aşağıdakilerden biri varsa açıklama
 * reddedilir ve deterministik şablon gösterilir:
 *   - olgularda / şablon metninde OLMAYAN bir sayı (uydurulmuş rakam)
 *   - kâr / marj / gelir / ciro iddiası (maliyet ve muhasebe verisi yok)
 *   - personel sıralaması, işe alma / işten çıkarma
 *   - desteklenmeyen neden-sonuç iddiası ("sayesinde", "yüzünden", "artırdı")
 *   - kesin fiyat önerisi, "menüden kaldırın"
 *   - sistemde değişiklik yaptığı iddiası ("güncelledim")
 */
export type AiExplanation = { summary: string; whyItMatters: string; suggestedAction: string };
export type ValidationFailure = "format" | "length" | "number" | "profit" | "employee" | "causal" | "prescription" | "mutation";
export type ValidationResult = { ok: true; value: AiExplanation } | { ok: false; reason: ValidationFailure };

const MAX_FIELD = 400;

const PATTERNS: Record<Exclude<ValidationFailure, "format" | "length" | "number">, RegExp[]> = {
  profit: [/\bkâr|\bkar(lı|lılık|sız|ınız| marjı)|\bmarj|\bgelir|\bciro|\bkazanç|\bzarar|\bprofit|\bmargin|\brevenue|\bearnings/iu],
  employee: [
    /(çalışan|personel|garson|aşçı|şef|kasiyer|employee|staff|waiter|cook)[^.]{0,60}(en (yavaş|hızlı|iyi|kötü|başarılı|başarısız)|sırala|performans|puan|uyar|rank|slowest|worst|best)/iu,
    /(işe al|işten çıkar|kovun|kovmak|ek eleman|bir çalışan daha|daha fazla personel al|hire|fire )/iu,
  ],
  causal: [/(sayesinde|yüzünden|nedeniyle|sebebiyle|neden oldu|yol açtı|artırdı|yükseltti|düşürdü|azalttı|caused|because of|led to|thanks to|resulted in|drove)/iu],
  prescription: [
    /(fiyat(ı|ını|ları|larını)?|price)[^.]{0,30}(yapın|yükseltin|düşürün|artırın|indirin|zam|set to|raise|lower)/iu,
    /(menüden|listeden)\s*(kaldırın|çıkarın)|remove (it )?from the menu/iu,
    /\d[\d.,]*\s*(₺|tl|try)\b[^.]{0,20}(yapın|olarak belirleyin|olsun)/iu,
  ],
  mutation: [/(değiştirdim|güncelledim|uyguladım|ayarladım|arşivledim|kaldırdım|i (have )?(changed|updated|applied|archived|removed))/iu],
};

/** Metindeki sayıları kanonik biçime çevirir: "1.234,5" → "1234.5", "11" → "11", "%31" → "31". */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const raw = m[0];
    const grouped = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw);
    const normalized = grouped ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(",", ".");
    const value = Number(normalized);
    if (Number.isFinite(value)) out.push(String(value));
  }
  return out;
}

/** İzin verilen sayılar: olgu değerleri + şablon metni + "nasıl hesaplandı" satırları (aynı biçimleyicilerle). */
export function allowedNumbers(candidate: InsightCandidate, rendered: RenderedInsight, currency: string): Set<string> {
  const texts: string[] = [rendered.title, rendered.finding, rendered.comparison ?? "", rendered.why, rendered.action, candidate.subject ?? ""];
  for (const m of candidate.metrics) {
    texts.push(m.label, m.note ?? "", fmtMetric(m.current, m.unit, currency), fmtMetric(m.previous ?? null, m.unit, currency));
  }
  const allowed = new Set<string>();
  for (const t of texts) for (const n of extractNumbers(t)) allowed.add(n);
  for (const v of Object.values(candidate.facts)) {
    if (typeof v === "number") {
      allowed.add(String(v));
      allowed.add(String(Math.round(v)));
      allowed.add(String(Math.abs(Math.round(v))));
    } else if (typeof v === "string") for (const n of extractNumbers(v)) allowed.add(n);
  }
  return allowed;
}

export function validateExplanation(raw: unknown, allowed: ReadonlySet<string>): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "format" };
  const r = raw as Record<string, unknown>;
  const fields = [r.summary, r.whyItMatters, r.suggestedAction];
  if (!fields.every((x) => typeof x === "string" && x.trim().length > 0)) return { ok: false, reason: "format" };
  const value: AiExplanation = { summary: (r.summary as string).trim(), whyItMatters: (r.whyItMatters as string).trim(), suggestedAction: (r.suggestedAction as string).trim() };
  const all = `${value.summary}\n${value.whyItMatters}\n${value.suggestedAction}`;
  if (Object.values(value).some((x) => x.length > MAX_FIELD)) return { ok: false, reason: "length" };
  if (/<[a-z/][^>]*>|```/i.test(all)) return { ok: false, reason: "format" };
  for (const n of extractNumbers(all)) if (!allowed.has(n)) return { ok: false, reason: "number" };
  for (const [reason, patterns] of Object.entries(PATTERNS) as [Exclude<ValidationFailure, "format" | "length" | "number">, RegExp[]][]) {
    if (patterns.some((p) => p.test(all))) return { ok: false, reason };
  }
  return { ok: true, value };
}
