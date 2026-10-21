import { PLAN_ORDER, PLANS, planHasFeature, planIncludes, type Feature } from "@/config/plans";
import type { TenantPlan } from "@prisma/client";

/**
 * Paket sunumu — TEK doğruluk kaynağı `config/plans.ts` (sunucu kapıları aynı tabloyu kullanır). Pazarlama yalnızca
 * gösterilecek ADLARI ve sırayı belirler; bir özelliğin hangi pakette olduğu tablodan türetilir (elle yazılmaz).
 *
 * Fiyatlar henüz belirlenmediği için UYDURULMAZ: her paket "Fiyat için iletişime geçin".
 * Sprint 20: sunucu bu tabloyu GERÇEKTEN uygular (src/server/billing/entitlements.ts) — kartlar ile yetki aynı kaynaktan.
 * Online ödeme pazarlamada GÖSTERİLMEZ: gerçek ödeme sağlayıcısı doğrulanmadı (vaat yok).
 */
export const MARKETING_FEATURES: readonly { key: Feature; label: string }[] = [
  { key: "qr_menu", label: "QR menü" },
  { key: "tables", label: "Masa & güvenli QR yönetimi" },
  { key: "qr_labels", label: "Baskıya hazır QR etiketleri" },
  { key: "branding", label: "Tema ve marka renkleri" },
  { key: "ordering", label: "Masadan sipariş" },
  { key: "kds", label: "Mutfak ekranı ve istasyonlar" },
  { key: "service_requests", label: "Garson çağrısı ve servis talepleri" },
  { key: "reservations", label: "Online rezervasyon" },
  { key: "crm", label: "Müşteriler, sadakat ve kuponlar" },
  { key: "analytics", label: "Analitik paneli" },
  { key: "voice_ai", label: "Sesli AI asistan (5 dilde konuşma)" },
  { key: "business_advisor", label: "AI İşletme Danışmanı" },
];

/** Sunum tercihi (yetki kararı değil): öne çıkan kart. */
const HIGHLIGHTED_PLAN: TenantPlan = "AI";

export const PRICE_LABEL = "Fiyat için iletişime geçin";

export type PlanCard = {
  plan: TenantPlan;
  name: string;
  summary: string;
  /** Bu pakete ÖZGÜ (önceki pakette olmayan) özellikler. */
  adds: string[];
  /** Önceki paketin adı ("Starter'ın tamamı +") — ilk pakette null. */
  includesPrevious: string | null;
  highlighted: boolean;
  priceLabel: string;
};

const SUMMARY: Record<TenantPlan, string> = {
  STARTER: "Dijital QR menünüzü ve masalarınızı yayına alın.",
  VOICE_MENU: "Küçük işletmeler için: misafir QR'ı okutur, menüyü sesli asistana sorar. Sipariş yok.",
  PRO: "Masadan siparişten mutfağa, servisten analitiğe tam operasyon.",
  AI: "Full: Pro'nun tamamı + sesli sipariş alan, 5 dilde konuşan asistan.",
};

export function includedIn(plan: TenantPlan, key: Feature): boolean {
  return planHasFeature(plan, key);
}

export function planCards(): PlanCard[] {
  return PLAN_ORDER.map((plan, index) => {
    // "X'in tamamı +" yalnızca bu paketin GERÇEKTEN kapsadığı en yakın önceki paket için (Sesli Menü ⊄ Pro).
    const previous = [...PLAN_ORDER.slice(0, index)].reverse().find((p) => planIncludes(plan, p)) ?? null;
    const adds = MARKETING_FEATURES.filter((f) => includedIn(plan, f.key) && !(previous && includedIn(previous, f.key))).map((f) => f.label);
    return {
      plan,
      name: PLANS[plan].label,
      summary: SUMMARY[plan],
      adds,
      includesPrevious: previous ? PLANS[previous].label : null,
      highlighted: plan === HIGHLIGHTED_PLAN,
      priceLabel: PRICE_LABEL,
    };
  });
}
