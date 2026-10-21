import { fmtCount, fmtDuration, fmtMoney, fmtPct, hourRange } from "@/lib/advisor/format";
import type { ActionType, InsightCandidate } from "@/lib/advisor/types";

/**
 * Deterministik açıklama şablonları (TR). AI yoksa / reddedilirse kart BUNLARLA gösterilir — danışman sağlayıcıya
 * bağımlı değildir. Kurallar:
 *   - "Sipariş Tutarı" (gelir / kâr / marj değil); kesin fiyat önerisi yok; "menüden kaldırın" yok.
 *   - Eylemler "değerlendirilebilir / gözden geçirilebilir" dilinde; işe alma / çıkarma, personel sıralaması yok.
 *   - Neden-sonuç iddiası yok ("…ile birlikte görülüyor", "nedenini kanıtlamaz").
 */
export type RenderedInsight = { title: string; finding: string; comparison: string | null; why: string; action: string };

const n = (v: unknown) => (typeof v === "number" ? v : 0);
const s = (v: unknown) => (typeof v === "string" ? v : "");

export const ACTION_LABELS: Record<ActionType, string> = {
  REVIEW_CAPACITY: "ilgili saatlerdeki hazırlık kapasitesini gözden geçirmek",
  REVIEW_STATION_LOAD: "istasyon iş yükünü ve ürün dağılımını gözden geçirmek",
  REVIEW_MENU_PLACEMENT: "ürünün menüdeki konumunu ve sunumunu gözden geçirmek",
  REVIEW_PRICING_STRATEGY: "fiyatlandırma ya da paketleme stratejisini ayrıca incelemek",
  REVIEW_SERVICE_COVERAGE: "ilgili bölge ve saatlerde servis kapsamasını gözden geçirmek",
  MONITOR: "eğilimi önümüzdeki günlerde izlemek",
  REVIEW_AI_SETTINGS: "AI asistan ayarlarını ve bağlantı durumunu gözden geçirmek",
};

export function renderInsight(c: InsightCandidate, currency: string): RenderedInsight {
  const f = c.facts;
  const up = n(f.deltaPct) > 0;
  switch (c.type) {
    case "ORDER_VOLUME_CHANGE":
      return {
        title: up ? "Sipariş sayısı arttı" : "Sipariş sayısı azaldı",
        finding: `Bu dönemde ${fmtCount(n(f.currentOrders))} sipariş alındı; önceki eşdeğer dönemde ${fmtCount(n(f.previousOrders))}.`,
        comparison: `${fmtCount(n(f.previousOrders))} → ${fmtCount(n(f.currentOrders))} (${fmtPct(n(f.deltaPct))})`,
        why: up ? "Daha yüksek hacim, yoğun saatlerde mutfak ve servis yükünü artırabilir." : "Sipariş hacmindeki düşüş, dönemsel bir dalgalanma ya da kalıcı bir değişim olabilir; nedeni bu veriden çıkarılamaz.",
        action: actionText(c),
      };
    case "AVERAGE_ORDER_CHANGE":
      return {
        title: up ? "Ortalama sipariş yükseldi" : "Ortalama sipariş düştü",
        finding: `Ortalama Sipariş ${fmtMoney(n(f.previousAverageMinor), currency)} → ${fmtMoney(n(f.currentAverageMinor), currency)}.`,
        comparison: `${fmtMoney(n(f.previousAverageMinor), currency)} → ${fmtMoney(n(f.currentAverageMinor), currency)} (${fmtPct(n(f.deltaPct))})`,
        why: "Ortalama sipariş, sepet içeriğindeki ve ürün karmasındaki değişimi yansıtır (gelir ya da kâr göstergesi değildir).",
        action: actionText(c),
      };
    case "ORDER_DAY_ANOMALY":
      return {
        title: n(f.robustZ) < 0 ? "Olağan dışı sakin bir gün" : "Olağan dışı yoğun bir gün",
        finding: `${s(f.day)} günü ${fmtCount(n(f.dayOrders))} sipariş alındı; önceki ${fmtCount(n(f.baselineDays))} günün medyanı ${fmtCount(n(f.baselineMedian))}.`,
        comparison: `${fmtCount(n(f.baselineMedian))} (medyan) → ${fmtCount(n(f.dayOrders))}`,
        why: "Gün, son haftaların olağan aralığının belirgin dışında. Hafta içi / hafta sonu farkı bu karşılaştırmada ayrıca modellenmez.",
        action: actionText(c),
      };
    case "REJECTION_RATE_CHANGE":
      return {
        title: n(f.deltaPp) > 0 ? "Sipariş ret oranı yükseldi" : "Sipariş ret oranı düştü",
        finding: `Reddedilen siparişlerin payı %${n(f.previousRatePct)} → %${n(f.currentRatePct)}.`,
        comparison: `%${n(f.previousRatePct)} → %${n(f.currentRatePct)}`,
        why: "Reddedilen siparişler misafirin beklediği ürünü alamaması demektir; tükenen ürünler ya da yoğunluk ilişkili olabilir.",
        action: actionText(c),
      };
    case "PREP_TIME_CHANGE":
      return {
        title: up ? "Hazırlama süresi uzadı" : "Hazırlama süresi kısaldı",
        finding: `Medyan hazırlama süresi ${fmtDuration(n(f.previousMedianMs))} → ${fmtDuration(n(f.currentMedianMs))}.`,
        comparison: `${fmtDuration(n(f.previousMedianMs))} → ${fmtDuration(n(f.currentMedianMs))} (${fmtPct(n(f.deltaPct))})`,
        why: up ? "Siparişler mutfakta daha uzun bekliyor; misafirin bekleme süresi artabilir." : "Siparişler mutfakta daha hızlı hazırlanıyor.",
        action: actionText(c),
      };
    case "PEAK_PREP_WINDOW": {
      const window = hourRange(n(f.startHour));
      const station = s(f.station);
      return {
        title: `${window} arasında hazırlama süresi yükseliyor`,
        finding: `Bu saatlerde medyan hazırlama süresi ${fmtDuration(n(f.windowMedianMs))}; dönem genelinde ${fmtDuration(n(f.overallMedianMs))}.${station ? ` Aynı saatlerde ${station} istasyonunun medyan fiş süresi ${fmtDuration(n(f.stationMedianMs))}.` : ""}`,
        comparison: `${fmtDuration(n(f.overallMedianMs))} → ${fmtDuration(n(f.windowMedianMs))} (${fmtPct(n(f.deltaPct))})`,
        why: "Yoğun saatlerde siparişler daha uzun bekleyebilir.",
        action: `Değerlendirilebilir: ${window} için ${station ? `${station} istasyonunun ` : ""}hazırlık kapasitesini veya ürün dağılımını gözden geçirmek.`,
      };
    }
    case "STATION_PREP_CHANGE":
      return {
        title: `${s(f.station)} istasyonunda fiş süresi ${up ? "uzadı" : "kısaldı"}`,
        finding: `${s(f.station)} istasyonunda medyan fiş süresi ${fmtDuration(n(f.previousMedianMs))} → ${fmtDuration(n(f.currentMedianMs))}.`,
        comparison: `${fmtDuration(n(f.previousMedianMs))} → ${fmtDuration(n(f.currentMedianMs))} (${fmtPct(n(f.deltaPct))})`,
        why: up ? "Bu istasyondaki gecikme, siparişin tamamının hazır olmasını geciktirebilir." : "İstasyon daha hızlı çalışıyor.",
        action: actionText(c, s(f.station)),
      };
    case "STATION_TAIL":
      return {
        title: `${s(f.station)} istasyonunda bazı fişler çok uzun sürüyor`,
        finding: `Medyan fiş süresi ${fmtDuration(n(f.medianMs))}, ancak fişlerin en yavaş %10'u ${fmtDuration(n(f.p90Ms))} ve üzerinde.`,
        comparison: `medyan ${fmtDuration(n(f.medianMs))} · p90 ${fmtDuration(n(f.p90Ms))}`,
        why: "Ortalama iyi görünse de bazı siparişler belirgin uzun bekliyor olabilir.",
        action: actionText(c, s(f.station)),
      };
    case "STATION_BOTTLENECK":
      return {
        title: `${s(f.station)} istasyonu siparişlerin çoğunda son tamamlanan`,
        finding: `Birden fazla istasyona düşen ${fmtCount(n(f.multiStationOrders))} siparişin ${fmtCount(n(f.lastReadyCount))} tanesinde (%${n(f.sharePct)}) en son ${s(f.station)} istasyonu hazır oldu.`,
        comparison: `%${n(f.sharePct)} son tamamlanan`,
        why: "Siparişin tamamı en yavaş istasyonu bekler; bu istasyon servis zamanını belirliyor olabilir.",
        action: actionText(c, s(f.station)),
      };
    case "SERVICE_RESPONSE_CHANGE":
      return {
        title: up ? "Servis taleplerine yanıt yavaşladı" : "Servis taleplerine yanıt hızlandı",
        finding: `Medyan yanıt süresi ${fmtDuration(n(f.previousMedianMs))} → ${fmtDuration(n(f.currentMedianMs))}.`,
        comparison: `${fmtDuration(n(f.previousMedianMs))} → ${fmtDuration(n(f.currentMedianMs))} (${fmtPct(n(f.deltaPct))})`,
        why: up ? "Misafirler garson çağrısı ve hesap gibi taleplerde daha uzun bekliyor olabilir." : "Taleplere daha hızlı yanıt veriliyor.",
        action: actionText(c),
      };
    case "AREA_SERVICE_GAP":
      return {
        title: `${s(f.slowArea)} bölgesinde servis yanıtı daha uzun`,
        finding: `${s(f.slowArea)} medyan yanıt süresi ${fmtDuration(n(f.slowMedianMs))}; ${s(f.fastArea)} bölgesinde ${fmtDuration(n(f.fastMedianMs))}.`,
        comparison: `${fmtDuration(n(f.fastMedianMs))} → ${fmtDuration(n(f.slowMedianMs))} (${fmtPct(n(f.gapPct))})`,
        why: "Bölgeler arası fark, bazı masaların servis kapsamasının dışında kalıyor olabileceğine işaret edebilir.",
        action: `Değerlendirilebilir: ${s(f.slowArea)} bölgesinde servis kapsamasını gözden geçirmek.`,
      };
    case "AREA_ORDER_CHANGE":
      return {
        title: `${s(f.area)} bölgesinde sipariş ${up ? "arttı" : "azaldı"}`,
        finding: `${s(f.area)} bölgesinden ${fmtCount(n(f.previousOrders))} → ${fmtCount(n(f.currentOrders))} sipariş.`,
        comparison: `${fmtCount(n(f.previousOrders))} → ${fmtCount(n(f.currentOrders))} (${fmtPct(n(f.deltaPct))})`,
        why: "Bölge hareketi, servis planlamasını etkileyebilir (müşteri memnuniyeti göstergesi değildir).",
        action: actionText(c),
      };
    case "PRODUCT_MOMENTUM":
      return {
        title: `${s(f.product)} ${up ? "daha çok" : "daha az"} sipariş ediliyor`,
        finding: `${s(f.product)} adedi önceki döneme göre ${fmtCount(n(f.previousQty))} → ${fmtCount(n(f.currentQty))}.`,
        comparison: `${fmtCount(n(f.previousQty))} → ${fmtCount(n(f.currentQty))} adet (${fmtPct(n(f.deltaPct))})`,
        why: up ? "Yükselen ürün, hazırlık ve stok planlamasında öne çıkabilir." : "Düşük hareket gören ürünün menüde fark edilip edilmediği ayrıca incelenebilir.",
        action: up ? "Değerlendirilebilir: ürünün stok ve hazırlık planını, menüdeki görünürlüğünü gözden geçirmek." : "Değerlendirilebilir: düşük hareket gören bu ürünün menüdeki konumunu veya sunumunu gözden geçirmek.",
      };
    case "MENU_HIGH_QTY_LOW_VALUE":
      return {
        title: `${s(f.product)}: yüksek adet, görece düşük katkı`,
        finding: `${s(f.product)} satılan ürünlerin %${n(f.qtySharePct)}'ini oluşturuyor, ancak sipariş tutarına katkısı %${n(f.valueSharePct)}.`,
        comparison: `adet payı %${n(f.qtySharePct)} · katkı payı %${n(f.valueSharePct)}`,
        why: "Maliyet verisi olmadığından kârlılık hakkında bir şey söylenemez; yalnızca adet ve sipariş tutarı payları karşılaştırılır.",
        action: "Değerlendirilebilir: bu ürün için fiyatlandırma veya paketleme stratejisini ayrıca incelemek.",
      };
    case "MENU_LOW_QTY_HIGH_VALUE":
      return {
        title: `${s(f.product)}: az adet, görece yüksek katkı`,
        finding: `${s(f.product)} satılan ürünlerin %${n(f.qtySharePct)}'i, ancak sipariş tutarına katkısı %${n(f.valueSharePct)}.`,
        comparison: `adet payı %${n(f.qtySharePct)} · katkı payı %${n(f.valueSharePct)}`,
        why: "Bu ürün az sipariş edilmesine rağmen sipariş tutarında görece büyük yer tutuyor.",
        action: "Değerlendirilebilir: ürünün menüdeki görünürlüğünü veya sunumunu gözden geçirmek.",
      };
    case "AI_FALLBACK_CHANGE":
      return {
        title: "Sesli asistanda bas-konuş moduna düşen tur oranı arttı",
        finding: `Bas-konuşa düşen turların payı %${n(f.previousRatePct)} → %${n(f.currentRatePct)}.`,
        comparison: `%${n(f.previousRatePct)} → %${n(f.currentRatePct)}`,
        why: "Canlı ses bağlantısı daha sık kesiliyor olabilir; misafir deneyimini etkileyebilir.",
        action: actionText(c),
      };
    case "AI_FAILURE_RATE":
      return {
        title: "AI asistan hataları yüksek",
        finding: `Bu dönemde ${fmtCount(n(f.failed))} başarısız tur / sağlayıcı hatası görüldü (%${n(f.ratePct)}).`,
        comparison: `%${n(f.ratePct)} hata`,
        why: "Hatalar misafirin asistandan yanıt alamaması demektir.",
        action: actionText(c),
      };
    case "AI_USAGE_CHANGE":
      return {
        title: up ? "AI asistan kullanımı arttı" : "AI asistan kullanımı azaldı",
        finding: `AI konuşması ${fmtCount(n(f.previousConversations))} → ${fmtCount(n(f.currentConversations))}.`,
        comparison: `${fmtCount(n(f.previousConversations))} → ${fmtCount(n(f.currentConversations))} (${fmtPct(n(f.deltaPct))})`,
        why: "Kullanım değişimi tek başına satışa etkisi hakkında bilgi vermez; mevcut veriler bir neden-sonuç ilişkisini kanıtlamaz.",
        action: actionText(c),
      };
  }
}

function actionText(c: InsightCandidate, subject?: string): string {
  const primary = c.actions[0] ?? "MONITOR";
  const label = ACTION_LABELS[primary];
  return `Değerlendirilebilir: ${subject && (primary === "REVIEW_STATION_LOAD" || primary === "REVIEW_CAPACITY") ? `${subject} istasyonu için ` : ""}${label}.`;
}

export const SEVERITY_LABELS = { INFO: "Bilgi", OPPORTUNITY: "Fırsat", ATTENTION: "Dikkat" } as const;
export const CONFIDENCE_LABELS = { HIGH: "Yüksek veri kalitesi", MEDIUM: "Orta veri kalitesi", LOW: "Sınırlı veri" } as const;
export const CATEGORY_LABELS = { SALES: "Sipariş", MENU: "Menü", OPERATIONS: "Operasyon", KDS: "Mutfak", SERVICE: "Servis", TABLES: "Masa / Bölge", AI_USAGE: "AI kullanımı" } as const;
