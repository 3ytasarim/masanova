import type { VoiceTurn } from "@/lib/marketing/voice-demo";

/**
 * MasaNova AI pazarlama metinleri — TEK yer (bileşenler metin içermez). Kurallar:
 * - Doğrulanamayan iddia YOK: müşteri logosu, restoran / sipariş sayısı, puan, ciro uydurulmaz.
 * - "Sipariş Tutarı" (gelir / kâr / marj değil); "Masadan sipariş" (online ödeme yok); hesap istemek ödeme değildir.
 * - Sesli AI: "5 dilde konuşma" (TR / EN / DE / AR / RU). Menü arayüzü çevirileri ayrı konu; genelleme yapılmaz.
 * - Örnek değerler açıkça "örnek" olarak işaretlenir.
 */

export const NAV = [
  { href: "#urun", label: "Ürün" },
  { href: "#sesli-asistan", label: "Voice AI" },
  { href: "#ozellikler", label: "Özellikler" },
  { href: "#analitik", label: "Analitik" },
  { href: "#paketler", label: "Paketler" },
] as const;

export const CTA = {
  demo: "Ücretsiz Demo İste",
  demoShort: "Demo İste",
  howItWorks: "Nasıl Çalışır?",
  watchVoice: "Sesli demoyu izle",
  login: "Giriş yap",
  whatsapp: "WhatsApp'tan yazın",
} as const;

export const HERO = {
  eyebrow: "Restoranlar için AI destekli servis ve operasyon platformu",
  title: "Restoranınızın yeni dijital garsonu.",
  lead: "QR menüden siparişe, mutfaktan servise ve 5 dilde konuşan sesli asistana kadar restoran operasyonunuz tek platformda.",
  assurances: ["Menü aktarımı ve kurulum desteği", "Masaya özel güvenli QR", "Kredi kartı gerekmez"],
} as const;

/** Hero kompozisyonundaki sahneler (görsel anlatı; ekran okuyucu için metin özeti de var). */
export const HERO_SCENES = {
  summary:
    "Örnek akış: misafir masadaki QR'ı okutur, menü açılır, sesli asistana bütçesini söyler, asistan menüden iki öneri getirir, sipariş mutfak ekranına düşer ve hazır olduğunda servis ekibine bildirilir.",
  table: "Masa 12 · Teras",
  ask: "İki kişiyiz, 800 lirayı geçmeden ne önerirsin?",
  answer: "Size menüden iki seçenek hazırladım:",
  cards: [
    { name: "Adana Kebap", price: "₺550", photo: "adana" as const },
    { name: "Çoban Salata", price: "₺150", photo: "coban" as const },
  ],
  total: "Toplam ₺700",
  ticket: { number: "#1042", table: "Masa 12", items: ["1× Adana Kebap", "1× Çoban Salata"], station: "Izgara" },
  ticketStates: ["Yeni", "Hazırlanıyor", "Hazır"],
  service: "Sipariş hazır · servis ekibine bildirildi",
} as const;

export const WHAT = {
  id: "urun",
  eyebrow: "MasaNova nedir?",
  title: "Bir QR menüden fazlası: masadan mutfağa tek sistem.",
  lead: "Misafir deneyimi ve restoran operasyonu aynı veriden beslenir. Menünüz güncellendiğinde QR menü, sesli asistan, mutfak ekranı ve raporlar aynı anda güncellenir.",
  pillars: [
    { title: "Misafir tarafı", items: ["Masaya özel QR menü", "Sesli AI asistan", "Masadan sipariş", "Garson çağırma"] },
    { title: "Restoran tarafı", items: ["Mutfak ekranı ve istasyonlar", "Canlı servis panosu", "Masa, QR ve etiket yönetimi", "Analitik"] },
  ],
} as const;

export const HOW = {
  id: "nasil-calisir",
  eyebrow: "Nasıl çalışır?",
  title: "Dört adımda dijital servis.",
  steps: [
    { title: "Masaya özel QR", text: "Her masaya basılı, markanıza uygun bir QR etiketi. Sipariş hangi masadan geldiyse orada kalır." },
    { title: "Misafir menüyü açar, AI ile konuşur", text: "Uygulama indirmeden menüye göz atar; isterse sesli asistana sorar, öneri alır." },
    { title: "Sipariş mutfağa canlı düşer", text: "Onaylanan sipariş doğru istasyona ayrılır; hazırlık durumu salonla paylaşılır." },
    { title: "Tüm operasyon panelde", text: "Siparişler, servis talepleri, hazırlama süreleri ve ürün performansı tek ekranda." },
  ],
} as const;

/** Masaüstünde yapışkan anlatı: metin değişir, telefon maketi aynı adımı gösterir. */
export const STORY = [
  { key: "menu", label: "Menü", title: "Menü, masada açılır.", text: "Kategoriler, ürün görselleri, varyantlar, ekstralar ve alerjen bilgisi — uygulama indirmeden." },
  { key: "ai", label: "Sesli AI", title: "Misafir sorar, asistan menünüzden yanıtlar.", text: "Bütçe, diyet tercihi ya da “acısız bir şey” — öneriler yalnızca menünüzdeki ürünlerden gelir." },
  { key: "order", label: "Sipariş", title: "Sepet masada, onay restoranda.", text: "Misafir siparişini gönderir; fiyat ve stok sunucuda yeniden doğrulanır, restoran onaylar." },
  { key: "kds", label: "Mutfak", title: "Her ürün doğru istasyona.", text: "Burger ızgaraya, içecek bara, tatlı tatlı istasyonuna — hazırlık durumu canlı." },
  { key: "analytics", label: "Analitik", title: "Ne sattı, ne kadar sürdü?", text: "Sipariş tutarı, yoğun saatler, ürün performansı ve servis yanıt süreleri." },
] as const;

export const VOICE = {
  id: "sesli-asistan",
  eyebrow: "Sesli AI asistan",
  title: "Menüyü konuşarak keşfedin.",
  lead: "Misafiriniz sorar; asistan menünüzü, fiyatlarınızı ve o anki stok durumunu bilerek yanıtlar. Söz kesebilir, dil değiştirebilir.",
  examples: ["Vegan ne var?", "600 TL altı öner.", "Garson çağır.", "Do you speak English?"],
  capabilities: [
    { title: "Menüyü bilir", text: "Yalnızca menünüzdeki ürünleri önerir; olmayan bir yemeği uydurmaz." },
    { title: "Fiyatı bilir", text: "Bütçeye göre öneri; fiyatlar her zaman güncel menüden." },
    { title: "Stoğu bilir", text: "Tükenen ürün önerilmez." },
    { title: "Alerjene dikkat eder", text: "İşletmenin beyan ettiği alerjen bilgisini aktarır; emin olmadığında personele yönlendirir." },
  ],
  languagesTitle: "5 dilde sesli konuşma",
  languages: [
    { code: "TR", name: "Türkçe" },
    { code: "EN", name: "English" },
    { code: "DE", name: "Deutsch" },
    { code: "AR", name: "العربية" },
    { code: "RU", name: "Русский" },
  ],
  languagesNote: "Sesli asistan bu 5 dilde konuşur. Menü içeriğinin çevirisi işletmenin girdiği çevirilere bağlıdır.",
  safeTitle: "AI önerir, restoran verisi doğrular.",
  safePoints: ["Fiyatlar menüden gelir", "Stok durumu anlık kontrol edilir", "Alerjen bilgisi işletmenin beyanıdır", "Sepete ekleme misafir onayıyla yapılır"],
  demoLabel: "Örnek konuşma — sessiz, görsel bir canlandırmadır",
  replay: "Demoyu yeniden oynat",
} as const;

/** Sesli demo senaryosu: Türkçe bütçe sorusu → İngilizceye geçiş. Tek sefer oynar. */
export const VOICE_SCRIPT: readonly VoiceTurn[] = [
  {
    locale: "tr",
    user: "İki kişiyiz, 800 lirayı geçmeden ne önerirsin?",
    reply: "Size menüden iki seçenek hazırladım. İkisi de 800 ₺'nin altında:",
    cards: [
      { name: "Adana Kebap + Çoban Salata", price: "₺700", note: "Paylaşmalık", photo: "adana" as const },
      { name: "Tavuk Şiş + Ayran ×2", price: "₺590", note: "Daha hafif", photo: "tavuk-sis" as const },
    ],
  },
  { locale: "en", user: "Do you speak English?", reply: "Of course! Would you like me to tell you about our desserts?" },
];

export const MENU = {
  id: "qr-menu",
  eyebrow: "QR menü",
  title: "Misafirin elinde, markanızın menüsü.",
  lead: "Fotoğraflı ürün kartları, kategoriler, varyant ve ekstralar, alerjen ve içerik bilgisi. Tema ve renkler markanıza göre.",
  points: ["Kategoriler ve arama", "Varyant ve ekstralar", "Alerjen ve diyet etiketleri", "Çok dilli arayüz", "Tükendi bilgisi anında"],
  sample: {
    categories: ["Popüler", "Kebaplar", "Dürümler", "Salatalar"],
    products: [
      { name: "Adana Kebap", desc: "Közlenmiş domates, biber, bulgur pilavı", price: "₺550", tags: ["Gluten"], photo: "adana" as const },
      { name: "Çoban Salata", desc: "Domates, salatalık, maydanoz", price: "₺150", tags: ["Vegan"], photo: "coban" as const },
      { name: "Urfa Dürüm", desc: "Lavaşta, közlenmiş domates", price: "₺400", tags: ["Gluten"], photo: "urfa-durum" as const },
    ],
    variants: ["1 Porsiyon", "1,5 Porsiyon"],
    modifiers: ["Ekstra lavaş +₺20"],
  },
  sampleNote: "Örnek menü — gerçek işletme verisi değildir.",
} as const;

export const ORDER = {
  id: "siparis",
  eyebrow: "Masadan sipariş",
  title: "Sepet masada, kontrol restoranda.",
  lead: "Misafir siparişini gönderir; fiyat ve stok sunucuda yeniden hesaplanır, restoran onaylar ve misafir durumu canlı izler. Ödeme masada, alışık olduğunuz şekilde.",
  steps: ["Sepete eklendi", "Sipariş gönderildi", "Restoran onayladı", "Hazırlanıyor", "Servis edildi"],
} as const;

export const KDS = {
  id: "mutfak",
  eyebrow: "Mutfak ekranı",
  title: "Her ürün doğru istasyona, her fiş doğru sırada.",
  lead: "Onaylanan sipariş istasyonlara ayrılır. Ekip ürünü hazırlar, ekran durumu salonla ve misafirle canlı paylaşır.",
  routes: [
    { item: "Burger", station: "Izgara" },
    { item: "Limonata", station: "Bar" },
    { item: "Sütlaç", station: "Tatlı" },
  ],
  columns: ["Yeni", "Hazırlanıyor", "Hazır"],
  ticket: { number: "#1042", table: "Masa 12" },
} as const;

export const SERVICE = {
  id: "servis",
  eyebrow: "Servis talepleri",
  title: "Garsonu aramaya son.",
  lead: "Misafir tek dokunuşla garson, su, peçete ya da hesap ister; talep servis panosuna anında düşer. Yanıt süreleri ölçülür.",
  requests: ["Garson Çağır", "Su İste", "Peçete İste", "Hesap İste"],
  status: "Personel ilgileniyor",
  note: "Hesap talebi personeli masaya çağırır; ödeme alınmaz.",
} as const;

export const ANALYTICS = {
  id: "analitik",
  eyebrow: "Analitik",
  title: "Hisle değil, veriyle yönetin.",
  lead: "Hangi ürün satıyor, hangi saat yoğun, mutfak ne kadar sürede hazırlıyor? Tarih aralığı, şube ve önceki dönem karşılaştırmasıyla.",
  sampleNote: "Örnek veriler — canlı işletme verisi değildir.",
  kpis: [
    { label: "Sipariş Tutarı", value: "₺48.250", delta: "+12%" },
    { label: "Sipariş Sayısı", value: "186", delta: "+8%" },
    { label: "Ortalama Sipariş", value: "₺259", delta: "+4%" },
    { label: "Hazırlama (medyan)", value: "14 dk", delta: "−2 dk" },
  ],
  hours: [
    { h: "12", v: 38 },
    { h: "13", v: 64 },
    { h: "14", v: 41 },
    { h: "17", v: 30 },
    { h: "19", v: 82 },
    { h: "20", v: 100 },
    { h: "21", v: 71 },
    { h: "22", v: 35 },
  ],
  more: ["Ürün performansı", "Servis yanıt süresi", "AI kullanımı", "CSV dışa aktarma"],
  definition: "Sipariş Tutarı, kabul edilmiş siparişlerin toplamıdır; gelir, kâr ya da marj değildir.",
} as const;

export const QR = {
  id: "qr-etiket",
  eyebrow: "Masa QR ve etiketler",
  title: "Basılı etiket, kalıcı adres.",
  lead: "Her masaya özel, markanıza uygun ve baskıya hazır QR etiketleri. QR kodu masaya bağlıdır; sipariş hangi masadan geldiyse orada kalır.",
  points: [
    { title: "Güvenli masa bağlamı", text: "Başka bir masanın QR'ı ile o masaya sipariş verilemez." },
    { title: "Kalıcı adres", text: "Alan adınız değişse bile basılı etiketler çalışmaya devam eder." },
    { title: "Marka uyumu", text: "Logo ve renklerinizle 5 hazır etiket şablonu." },
    { title: "Baskıya hazır", text: "Tek masa ya da A4 toplu sayfa olarak PDF." },
  ],
  label: { brand: "MasaNova AI", table: "Masa 12", cta: "Menü için okutun", hint: "Sesli asistan · 5 dil" },
} as const;

export const FEATURES = {
  id: "ozellikler",
  eyebrow: "Özellikler",
  title: "İhtiyacınız olan her şey, tek panelde.",
  items: [
    { icon: "qr", title: "QR Menü", text: "Fotoğraflı, çok dilli arayüz." },
    { icon: "table", title: "Masa Yönetimi", text: "Bölgeler, masalar, güvenli QR." },
    { icon: "bag", title: "Sipariş", text: "Masadan sipariş ve canlı durum." },
    { icon: "chef", title: "Mutfak Ekranı", text: "Fişler, durumlar, süreler." },
    { icon: "split", title: "İstasyonlar", text: "Ürünü doğru istasyona yönlendirir." },
    { icon: "bell", title: "Garson Çağrıları", text: "Garson, su, peçete, hesap." },
    { icon: "mic", title: "Voice AI", text: "5 dilde sesli asistan." },
    { icon: "chart", title: "Analitik", text: "Tutar, saat, ürün, süre." },
    { icon: "calendar", title: "Rezervasyon", text: "Online rezervasyon, walk-in, masa planı." },
    { icon: "printer", title: "QR Etiket", text: "Baskıya hazır PDF şablonlar." },
    { icon: "store", title: "Çoklu Şube", text: "Şubeye özel fiyat ve stok." },
    { icon: "palette", title: "Tema / Marka", text: "Logo, kapak, renkler." },
  ],
} as const;

export const TRUST = {
  title: "Güven, tasarımın parçası.",
  items: [
    { title: "Güvenli masa bağlamı", text: "Her QR yalnızca kendi masasına sipariş verebilir." },
    { title: "Anlık fiyat doğrulama", text: "Sepetteki tutar sipariş anında sunucuda yeniden hesaplanır." },
    { title: "İşletmeler arası yalıtım", text: "Her işletmenin verisi yalnızca kendisine görünür." },
    { title: "Gerçek zamanlı operasyon", text: "Sipariş, mutfak ve servis panoları sayfa yenilemeden güncellenir." },
  ],
} as const;

export const PLANS_COPY = {
  id: "paketler",
  eyebrow: "Paketler",
  title: "İşletmenizle birlikte büyüyen paketler.",
  lead: "Fiyatlar işletme büyüklüğüne ve şube sayısına göre belirlenir. Size uygun paketi demoda birlikte seçelim.",
  includes: (name: string) => `${name} paketinin tamamı +`,
  cta: "Teklif İste",
  recommended: "Önerilen",
} as const;

export const DEMO = {
  id: "demo",
  title: "Restoranınızda nasıl çalıştığını görün.",
  lead: "Formu doldurun; ekibimiz menünüzün aktarımını, masa ve QR kurulumunu ve size uygun paketi birlikte planlamak için sizinle iletişime geçsin.",
  points: ["Menünüzün dijitale aktarımı", "Masa ve QR etiket kurulumu", "Ekibiniz için kısa eğitim"],
} as const;

export const FOOTER = {
  tagline: "Restoranlar için AI destekli dijital servis ve operasyon platformu.",
  columns: [
    { title: "Ürün", links: [...NAV.slice(0, 4)] },
    {
      title: "Şirket",
      links: [
        { href: "#demo", label: "Demo iste" },
        { href: "/giris", label: "Giriş yap" },
      ],
    },
  ],
} as const;

export const SEO = {
  title: "MasaNova AI | Yapay Zeka Destekli QR Menü ve Restoran Yönetimi",
  description:
    "QR menü, masadan sipariş, mutfak ekranı (KDS), garson çağırma, analitik ve 5 dilde konuşan sesli AI asistan. Restoranınızın dijital garsonu tek platformda.",
  ogTitle: "Restoranınızın yeni dijital garsonu — MasaNova AI",
  featureList: [
    "QR menü",
    "Masaya özel güvenli QR",
    "Masadan sipariş",
    "Mutfak ekranı (KDS) ve istasyonlar",
    "Garson çağrısı ve servis talepleri",
    "Analitik paneli",
    "Sesli AI asistan (Türkçe, İngilizce, Almanca, Arapça, Rusça)",
    "Baskıya hazır QR etiketleri",
  ],
} as const;

/** Geleneksel işleyiş ile karşılaştırma — yalnızca ürünün GERÇEKTEN yaptıkları (POS / stok / reçete entegrasyonu iddiası yok). */
export const COMPARE = {
  id: "karsilastirma",
  eyebrow: "Servisteki darboğazlar",
  title: "Klasik servis ile MasaNova arasındaki fark.",
  lead: "Yoğun saatte zaman kaybettiren adımlar, masadan mutfağa tek akışta toplanır.",
  head: { area: "Konu", classic: "Klasik işleyiş", masanova: "MasaNova AI" },
  rows: [
    { area: "Sipariş", classic: "Garsonun masaya gelmesi beklenir", masanova: "Masadan anında: QR menüden ya da sesle" },
    { area: "Ürün bilgisi", classic: "İçerik ve alerjen personelin hafızasında", masanova: "Menüde girilen bilgi, her soruda aynı ve güncel" },
    { area: "Yabancı misafir", classic: "Dil engeli, yanlış anlaşılan sipariş", masanova: "5 dilde konuşan sesli garson" },
    { area: "Mutfağa aktarım", classic: "Kâğıt fiş, sözlü iletim", masanova: "İstasyona göre ayrılan mutfak ekranı" },
    { area: "Garson / hesap çağırma", classic: "El kaldırma, göz teması bekleme", masanova: "Tek dokunuş; servis panosunda canlı" },
    { area: "Tükenen ürün", classic: "Sipariş alındıktan sonra fark edilir", masanova: "Anında menüde ve asistanda “tükendi”" },
    { area: "Raporlama", classic: "Gün sonu tahmin ve defter", masanova: "Canlı sipariş, mutfak ve servis analitiği" },
  ],
} as const;

/** "Menünüzü bilen garson" — örnek ürün üzerinde soru seç → yanıt. Yanıtlar örnek menü verisidir (gerçek işletme değil). */
export const MENU_QA = {
  id: "menu-bilgisi",
  eyebrow: "Ürünü tanıyan asistan",
  title: "Menünüzü en iyi bilen garson.",
  lead: "Misafir içerik, alerjen, acılık ya da porsiyon sorduğunda asistan yanıtı menünüzde girdiğiniz bilgilerden verir; bilmediği konuda tahmin yürütmez, personele yönlendirir.",
  prompt: "Misafirin sorusunu seçin:",
  answerLabel: "Sesli garsonun yanıtı",
  product: { name: "Adana Kebap", price: "₺550", photo: "adana" as const, tag: "Örnek ürün" },
  questions: [
    { q: "İçinde ne var?", a: "Zırh kıyması dana ve kuzu eti, pul biber ve tuzla hazırlanıyor. Yanında közlenmiş domates, biber, bulgur pilavı ve lavaş geliyor." },
    { q: "Alerjen var mı?", a: "Restoranın belirttiğine göre lavaş ve pilav gluten içeriyor; kebabın kendisi için beyan edilmiş bir alerjen yok. Hassasiyetiniz varsa çapraz bulaşma için personelimize danışmanızı öneririm." },
    { q: "Acı mı?", a: "Orta acılıdır. İsterseniz acısız hazırlanması için mutfağa not ekleyebilirim." },
    { q: "Porsiyon ne kadar?", a: "Bir porsiyon ₺550, bir buçuk porsiyon da var. İki kişi paylaşacaksanız yanına bir Çoban Salata iyi gider." },
    { q: "Yanına ne gider?", a: "Menüde yanına en çok yakışanlar Çoban Salata ve ayran. İkisini birlikte eklersem toplam ₺765 olur; ekleyeyim mi?" },
  ],
  note: "Örnek menü — yanıtlar işletmenin menüde girdiği bilgilerden üretilir.",
} as const;

/** Sesli sipariş onay akışı — sipariş YALNIZCA misafirin sesli onayından sonra mutfağa gider. */
export const VOICE_FLOW = {
  id: "sesli-siparis",
  eyebrow: "Yanlış sipariş yok",
  title: "Sesli sipariş, üç adımda ve onaylı.",
  lead: "Asistan siparişi kendiliğinden göndermez. Misafir söyler, asistan özetler, misafir onaylar; sipariş o anda mutfağa düşer.",
  steps: [
    { title: "Misafir söyler", text: "Bir Adana Kebap, iki büyük ayran. Asistan ürünleri menünüzle eşleştirir; emin değilse tekrar sorar.", quote: "“Bir Adana, iki büyük ayran.”" },
    { title: "Asistan özetler", text: "Siparişi ve toplamı sesli okur, eksik seçim varsa (boyut, pişirme) sorar.", quote: "“Bir Adana Kebap ve iki büyük ayran, toplam ₺680. Onaylıyor musunuz?”" },
    { title: "Onay, mutfak", text: "Misafir “evet” der; sipariş mutfak ekranına ve panele düşer, ekip sesli bildirimle haberdar olur.", quote: "“Siparişiniz mutfağa iletildi, numaranız 1042.”" },
  ],
} as const;
