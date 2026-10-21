import { ACTION_LABELS, type RenderedInsight } from "@/lib/advisor/templates";
import type { InsightCandidate } from "@/lib/advisor/types";
import { fmtMetric } from "@/lib/advisor/format";

/**
 * İşletme Danışmanı istem metni — müşteri sesli asistanının istemlerinden TAMAMEN AYRI (farklı rol, farklı bağlam,
 * konuşma geçmişi yok, araç yok). Modele yalnızca derli toplu, biçimlendirilmiş olgular gider (ham tablo / müşteri
 * verisi yok); model yeni sayı üretmemeli — çıktı yine de sunucuda doğrulanır (validate.ts).
 */
export const ADVISOR_SYSTEM_PROMPT = [
  "Sen bir restoranın işletme sahibine operasyon verilerini açıklayan, sakin ve dikkatli bir danışmansın. Türkçe yaz.",
  "Sana deterministik analitik kurallarının bulduğu içgörüler JSON olarak verilecek. Her biri için kısa bir açıklama yaz.",
  "KURALLAR:",
  "1) YALNIZCA verilen olgulardaki sayıları kullan. Yeni sayı, yüzde, tutar ya da tarih UYDURMA. Emin değilsen sayı kullanma.",
  "2) Kâr, marj, gelir, ciro, kazanç ya da zarar deme — maliyet ve muhasebe verisi yok. Tutarlar 'Sipariş Tutarı'dır.",
  "3) Neden-sonuç iddiası kurma ('sayesinde', 'yüzünden', 'artırdı' gibi). Veriler yalnızca birlikte görülen değişimleri gösterir.",
  "4) Çalışanları sıralama, puanlama; işe alma / işten çıkarma önerme. İstasyon, saat ve bölge düzeyinde konuş.",
  "5) Kesin fiyat önerme, 'menüden kaldırın' deme. Önerileri 'değerlendirilebilir / gözden geçirilebilir' diliyle yaz.",
  "6) Hiçbir değişikliği yaptığını iddia etme; sen yalnızca öneri sunarsın.",
  "7) Her alan en fazla 2 cümle. HTML / markdown kullanma.",
  'ÇIKTI: yalnızca JSON dizi: [{"id": "...", "summary": "...", "whyItMatters": "...", "suggestedAction": "..."}]',
].join("\n");

export type ExplainItem = {
  id: string;
  type: string;
  category: string;
  subject: string | null;
  title: string;
  finding: string;
  /** Biçimlendirilmiş olgular (modelin görebileceği TEK sayı kaynağı). */
  facts: { label: string; current: string; previous: string | null }[];
  allowedActions: string[];
};

export function toExplainItem(id: string, c: InsightCandidate, rendered: RenderedInsight, currency: string): ExplainItem {
  return {
    id,
    type: c.type,
    category: c.category,
    subject: c.subject,
    title: rendered.title,
    finding: rendered.finding,
    facts: c.metrics.map((m) => ({ label: m.label, current: fmtMetric(m.current, m.unit, currency), previous: m.previous === undefined ? null : fmtMetric(m.previous, m.unit, currency) })),
    allowedActions: c.actions.map((a) => ACTION_LABELS[a]),
  };
}

/** Model çıktısından JSON dizi ayıklar (kod çiti / ön-son metin toleransı). Geçersizse boş. */
export function parseExplanationArray(text: string): Record<string, unknown>[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : [];
  } catch {
    return [];
  }
}
