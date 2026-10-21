import type { RangeKey } from "@/lib/analytics/range";

/**
 * Analitik paneli metinleri (TR / EN). Panel dili işletmenin varsayılan diline göre seçilir (en → İngilizce, diğerleri
 * → Türkçe); DE / AR / RU panel çevirisi henüz yok (panelin geri kalanı da Türkçe).
 * Terim ilkesi: muhasebe modellenmediği için "net ciro / kâr / marj" KULLANILMAZ → "Sipariş tutarı".
 */
export type AnalyticsLabels = {
  title: string;
  description: string;
  period: string;
  ranges: Record<RangeKey, string>;
  from: string;
  to: string;
  allBranches: string;
  branch: string;
  apply: string;
  refresh: string;
  lastUpdated: string;
  comparedTo: string;
  tabs: { overview: string; products: string; tables: string; operations: string; service: string; ai: string };
  kpi: { sales: string; orders: string; average: string; items: string; tables: string; prep: string; response: string };
  previous: string;
  lowData: string;
  noChange: string;
  notEnoughData: string;
  loadError: string;
  rangeErrors: { invalid_dates: string; range_too_long: string; future: string; branch_invalid: string };
  salesDefinition: string;
  otherCurrency: (n: number) => string;
  trendTitle: (hourly: boolean) => string;
  ordersUnit: string;
  funnelTitle: string;
  funnel: { submitted: string; pending: string; accepted: string; rejected: string; preparing: string; ready: string; served: string; cancelled: string };
  acceptanceRate: string;
  rejectionRate: string;
  heatmapTitle: string;
  heatmapEmpty: string;
  weekdays: string[];
  products: { title: string; quantity: string; orders: string; contribution: string; avgUnit: string; share: string; archived: string; deleted: string; formerly: string; variants: string; modifiers: string; modifierNote: string; categories: string; categoryNote: string; unknownCategory: string; quadrants: string; quadrantNote: string; quadrantNames: Record<"highQtyHighValue" | "highQtyLowValue" | "lowQtyHighValue" | "lowQtyLowValue", string>; conversionUnavailable: string; soldOutUnavailable: string };
  tables: { title: string; table: string; area: string; noArea: string; orders: string; total: string; average: string; requests: string; scans: string; scansNote: string; areas: string; activeTables: string; formerly: string };
  ops: { title: string; acceptance: string; preparation: string; readyToServed: string; average: string; median: string; p90: string; samples: string; stations: string; station: string; tickets: string; wait: string; staffNote: string };
  service: { title: string; total: string; completed: string; cancelled: string; response: string; completion: string; byType: string; byHour: string; byArea: string; byTable: string; types: Record<string, string>; staffNote: string };
  ai: { title: string; conversations: string; turns: string; voiceMinutes: string; fallbackRate: string; interruptions: string; reconnects: string; failed: string; convLanguages: string; msgLanguages: string; actions: string; actionKinds: Record<string, string>; productCards: string; recommendations: string; correlationUnavailable: string; privacy: string };
  exports: { title: string; orders: string; products: string; service: string; kds: string; note: string };
  showTable: string;
};

const tr: AnalyticsLabels = {
  title: "Analitik",
  description: "MasaNova'ya kaydedilen siparişler, mutfak, servis ve AI verilerinden hesaplanır.",
  period: "Dönem",
  ranges: { today: "Bugün", yesterday: "Dün", last7: "Son 7 gün", last30: "Son 30 gün", thisMonth: "Bu ay", lastMonth: "Geçen ay", custom: "Özel aralık" },
  from: "Başlangıç",
  to: "Bitiş",
  allBranches: "Tüm şubeler",
  branch: "Şube",
  apply: "Uygula",
  refresh: "Yenile",
  lastUpdated: "Son güncelleme",
  comparedTo: "Karşılaştırma",
  tabs: { overview: "Genel", products: "Ürünler", tables: "Masalar", operations: "Mutfak", service: "Servis", ai: "AI" },
  kpi: { sales: "Sipariş tutarı", orders: "Sipariş", average: "Ortalama sepet", items: "Satılan ürün", tables: "Aktif masa", prep: "Ort. hazırlama", response: "Ort. servis yanıtı" },
  previous: "Önceki",
  lowData: "Karşılaştırma için yeterli veri yok",
  noChange: "Değişim yok",
  notEnoughData: "Henüz yeterli veri yok.",
  loadError: "Analitik veriler şu anda yüklenemiyor.",
  rangeErrors: { invalid_dates: "Geçerli bir tarih aralığı seçin.", range_too_long: "Tarih aralığı en fazla 366 gün olabilir.", future: "Gelecek tarihler seçilemez.", branch_invalid: "Şube bulunamadı." },
  salesDefinition: "Sipariş tutarı: restoranın kabul ettiği siparişlerin kayıtlı toplamı. Reddedilen, iptal edilen ve kabul bekleyen siparişler dahil değildir. Vergi / iade / ödeme mutabakatı içermez; muhasebe cirosu değildir.",
  otherCurrency: (n) => `${n} sipariş farklı para birimiyle verildi ve toplama katılmadı.`,
  trendTitle: (h) => (h ? "Saatlik sipariş tutarı" : "Günlük sipariş tutarı"),
  ordersUnit: "sipariş",
  funnelTitle: "Sipariş hunisi",
  funnel: { submitted: "Gönderilen", pending: "Kabul bekleyen", accepted: "Kabul edilen", rejected: "Reddedilen", preparing: "Hazırlanan", ready: "Hazır olan", served: "Servis edilen", cancelled: "İptal edilen" },
  acceptanceRate: "Kabul oranı",
  rejectionRate: "Ret oranı",
  heatmapTitle: "Yoğun saatler (gün × saat)",
  heatmapEmpty: "Yoğunluk haritası için en az 20 sipariş gerekir.",
  weekdays: ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"],
  products: {
    title: "Ürün performansı",
    quantity: "Adet",
    orders: "Sipariş",
    contribution: "Sipariş tutarı katkısı",
    avgUnit: "Ort. birim",
    share: "Adet payı",
    archived: "Arşivde",
    deleted: "Menüden kaldırıldı",
    formerly: "Sipariş anındaki adı",
    variants: "Varyant dağılımı",
    modifiers: "En çok seçilen ekstralar",
    modifierNote: "Yalnızca menüdeki seçenekler; serbest sipariş notları dahil değildir.",
    categories: "Kategoriler",
    categoryNote: "Güncel kategori görünümü: siparişler ürünün bugünkü kategorisine göre gruplanır (sipariş anındaki kategori kaydedilmedi).",
    unknownCategory: "Kategorisi bilinmiyor (ürün artık yok)",
    quadrants: "Menü dağılımı",
    quadrantNote: "Satış adedi × ortalama birim tutar (ürün medyanına göre). Maliyet verisi olmadığı için kârlılık DEĞİLDİR.",
    quadrantNames: { highQtyHighValue: "Çok satan · yüksek tutar", highQtyLowValue: "Çok satan · düşük tutar", lowQtyHighValue: "Az satan · yüksek tutar", lowQtyLowValue: "Az satan · düşük tutar" },
    conversionUnavailable: "Menü görüntüleme → sipariş dönüşümü ölçülmüyor (görüntüleme olayları saklanmıyor).",
    soldOutUnavailable: "Tükendi geçmişi saklanmadığı için \"kaç saat tükendi\" bilgisi gösterilmez.",
  },
  tables: {
    title: "Masalar",
    table: "Masa",
    area: "Bölge",
    noArea: "Bölgesiz",
    orders: "Sipariş",
    total: "Sipariş tutarı",
    average: "Ortalama",
    requests: "Servis talebi",
    scans: "QR tarama (toplam)",
    scansNote: "QR taramaları yalnızca tüm zamanların toplamı olarak tutulur; döneme göre tarama analizi yapılmaz.",
    areas: "Bölgeler",
    activeTables: "Aktif masa",
    formerly: "Sipariş anındaki adı",
  },
  ops: {
    title: "Mutfak ve operasyon süreleri",
    acceptance: "Sipariş kabul süresi",
    preparation: "Hazırlama süresi (kabul → hazır)",
    readyToServed: "Hazır → servis",
    average: "Ortalama",
    median: "Medyan",
    p90: "p90",
    samples: "örnek",
    stations: "İstasyonlar",
    station: "İstasyon",
    tickets: "Fiş",
    wait: "Ort. bekleme",
    staffNote: "Süreler restoran / istasyon geneli içindir; personel bazlı sıralama yapılmaz.",
  },
  service: {
    title: "Servis talepleri",
    total: "Toplam talep",
    completed: "Tamamlanan",
    cancelled: "İptal",
    response: "Yanıt süresi",
    completion: "Tamamlanma süresi",
    byType: "Türe göre",
    byHour: "Saatlere göre",
    byArea: "Bölgelere göre",
    byTable: "Masalara göre",
    types: { WAITER: "Garson", WATER: "Su", NAPKIN: "Peçete", BILL: "Hesap", CUSTOM: "Özel istek" },
    staffNote: "Restoran geneli yanıt süreleri; personel adı ya da sıralaması gösterilmez.",
  },
  ai: {
    title: "Sesli AI kullanımı",
    conversations: "Konuşma",
    turns: "Tur",
    voiceMinutes: "Ses süresi",
    fallbackRate: "Bas-konuş yedek oranı",
    interruptions: "Söz kesme",
    reconnects: "Yeniden bağlanma",
    failed: "Başarısız tur",
    convLanguages: "Konuşma dilleri",
    msgLanguages: "Mesaj dilleri",
    actions: "Hazırlanan eylem kartları",
    actionKinds: { cart_add: "Sepete ekleme", cart_change: "Sepet değişikliği", configure: "Ürün seçimi", open_cart: "Sepeti açma", service: "Servis talebi" },
    productCards: "Gösterilen ürün kartı",
    recommendations: "Öneri",
    correlationUnavailable: "AI kullanımı ile sipariş arasında güvenilir bir oturum bağı saklanmadığı için \"AI kaynaklı sipariş\" hesaplanmaz.",
    privacy: "Konuşma metinleri gösterilmez; yalnızca sayılar.",
  },
  exports: { title: "CSV dışa aktar", orders: "Siparişler", products: "Ürün performansı", service: "Servis talepleri", kds: "Mutfak fişleri", note: "Seçili dönem ve şube; en fazla 50.000 satır. Zamanlar restoranın yerel saatiyle (UTC ofsetiyle)." },
  showTable: "Tablo olarak göster",
};

const en: AnalyticsLabels = {
  ...tr,
  title: "Analytics",
  description: "Calculated from orders, kitchen, service and AI data recorded in MasaNova.",
  period: "Period",
  ranges: { today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last30: "Last 30 days", thisMonth: "This month", lastMonth: "Last month", custom: "Custom range" },
  from: "From",
  to: "To",
  allBranches: "All branches",
  branch: "Branch",
  apply: "Apply",
  refresh: "Refresh",
  lastUpdated: "Last updated",
  comparedTo: "Compared with",
  tabs: { overview: "Overview", products: "Products", tables: "Tables", operations: "Kitchen", service: "Service", ai: "AI" },
  kpi: { sales: "Order value", orders: "Orders", average: "Average order", items: "Items sold", tables: "Active tables", prep: "Avg. preparation", response: "Avg. service response" },
  previous: "Previous",
  lowData: "Not enough data to compare",
  noChange: "No change",
  notEnoughData: "Not enough data yet.",
  loadError: "Analytics data cannot be loaded right now.",
  rangeErrors: { invalid_dates: "Choose a valid date range.", range_too_long: "The range can be at most 366 days.", future: "Future dates cannot be selected.", branch_invalid: "Branch not found." },
  salesDefinition: "Order value: recorded total of orders accepted by the restaurant. Rejected, cancelled and pending orders are excluded. No tax / refunds / payment settlement — not accounting revenue.",
  otherCurrency: (n) => `${n} orders in a different currency were not added to the total.`,
  trendTitle: (h) => (h ? "Hourly order value" : "Daily order value"),
  ordersUnit: "orders",
  funnelTitle: "Order funnel",
  funnel: { submitted: "Submitted", pending: "Awaiting acceptance", accepted: "Accepted", rejected: "Rejected", preparing: "Preparing", ready: "Ready", served: "Served", cancelled: "Cancelled" },
  acceptanceRate: "Acceptance rate",
  rejectionRate: "Rejection rate",
  heatmapTitle: "Busy hours (day × hour)",
  heatmapEmpty: "At least 20 orders are needed for the heatmap.",
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  products: {
    title: "Product performance",
    quantity: "Qty",
    orders: "Orders",
    contribution: "Order value contribution",
    avgUnit: "Avg. unit",
    share: "Share of items",
    archived: "Archived",
    deleted: "Removed from menu",
    formerly: "Name at order time",
    variants: "Variant split",
    modifiers: "Most selected extras",
    modifierNote: "Menu options only; free-text order notes are not included.",
    categories: "Categories",
    categoryNote: "Current-category view: orders are grouped by the product's category today (category at order time was not recorded).",
    unknownCategory: "Unknown category (product no longer exists)",
    quadrants: "Menu mix",
    quadrantNote: "Quantity sold × average unit value (relative to the product median). Not profitability — no cost data.",
    quadrantNames: { highQtyHighValue: "High sales · high value", highQtyLowValue: "High sales · low value", lowQtyHighValue: "Low sales · high value", lowQtyLowValue: "Low sales · low value" },
    conversionUnavailable: "Menu view → order conversion is not measured (view events are not stored).",
    soldOutUnavailable: "Sold-out history is not stored, so \"hours sold out\" is not shown.",
  },
  tables: {
    title: "Tables",
    table: "Table",
    area: "Area",
    noArea: "No area",
    orders: "Orders",
    total: "Order value",
    average: "Average",
    requests: "Service requests",
    scans: "QR scans (total)",
    scansNote: "QR scans are stored only as an all-time total; no per-period scan analytics.",
    areas: "Areas",
    activeTables: "Active tables",
    formerly: "Name at order time",
  },
  ops: {
    title: "Kitchen and operations timings",
    acceptance: "Order acceptance time",
    preparation: "Preparation (accepted → ready)",
    readyToServed: "Ready → served",
    average: "Average",
    median: "Median",
    p90: "p90",
    samples: "samples",
    stations: "Stations",
    station: "Station",
    tickets: "Tickets",
    wait: "Avg. wait",
    staffNote: "Timings are restaurant / station wide; no per-employee ranking.",
  },
  service: {
    title: "Service requests",
    total: "Total requests",
    completed: "Completed",
    cancelled: "Cancelled",
    response: "Response time",
    completion: "Completion time",
    byType: "By type",
    byHour: "By hour",
    byArea: "By area",
    byTable: "By table",
    types: { WAITER: "Waiter", WATER: "Water", NAPKIN: "Napkin", BILL: "Bill", CUSTOM: "Custom" },
    staffNote: "Restaurant-wide response times; no staff names or rankings.",
  },
  ai: {
    title: "Voice AI usage",
    conversations: "Conversations",
    turns: "Turns",
    voiceMinutes: "Voice time",
    fallbackRate: "Push-to-talk fallback rate",
    interruptions: "Interruptions",
    reconnects: "Reconnects",
    failed: "Failed turns",
    convLanguages: "Conversation languages",
    msgLanguages: "Message languages",
    actions: "Action cards prepared",
    actionKinds: { cart_add: "Add to cart", cart_change: "Cart change", configure: "Product options", open_cart: "Open cart", service: "Service request" },
    productCards: "Product cards shown",
    recommendations: "Recommendations",
    correlationUnavailable: "No reliable session link between AI use and orders is stored, so \"AI-driven orders\" are not calculated.",
    privacy: "Conversation texts are never shown; counts only.",
  },
  exports: { title: "CSV export", orders: "Orders", products: "Product performance", service: "Service requests", kds: "Kitchen tickets", note: "Selected period and branch; max 50,000 rows. Times in restaurant local time (with UTC offset)." },
  showTable: "Show as table",
};

export function analyticsLabels(locale: string | null | undefined): AnalyticsLabels {
  return locale === "en" ? en : tr;
}

/** İstemci filtre çubuğuna yalnızca DÜZ metinler gider (fonksiyon içeren etiket nesnesi sunucu → istemci sınırını geçemez). */
export type FilterLabels = Pick<AnalyticsLabels, "period" | "ranges" | "from" | "to" | "allBranches" | "branch" | "apply" | "refresh">;

export function filterLabels(L: AnalyticsLabels): FilterLabels {
  return { period: L.period, ranges: L.ranges, from: L.from, to: L.to, allBranches: L.allBranches, branch: L.branch, apply: L.apply, refresh: L.refresh };
}
