/**
 * Public QR menü — tarayıcıya giden VERİ SÖZLEŞMESİ. Sunucu (toPublicMenuView) üretir, istemci yalnızca gösterir.
 *
 * Bilinçli olarak YOK: kiracı / şube / masa / ürün iç kimlikleri, SKU, maliyet, arşiv/pasif kayıtlar, şube dışı
 * fiyatlar, denetim alanları. Ürün anahtarı kiracı içi benzersiz kısa addır (slug).
 * Fiyatlar sunucuda merkezi fiyat çözümleyicisiyle hesaplanıp BİÇİMLENMİŞ metin olarak gelir; istemci fiyat hesaplamaz.
 */
import type { MenuLocale } from "@/config/menu";

export type PublicMenuStyleKey = "COMPACT" | "VISUAL" | "LUXURY" | "MODERN";

export type PublicProductView = {
  key: string;
  categoryKey: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  featured: boolean;
  soldOut: boolean;
  /** "₺380,00" ya da varyantlıysa en düşük fiyat. */
  priceLabel: string;
  startingFrom: boolean;
  preparationMinutes: number | null;
  images: { url: string; srcSet?: string | null; alt: string | null }[];
  /** Para birimi ve varyantsız ürünün çözülmüş fiyatı (sepet önizlemesi için; yetkili değildir). */
  currency: string;
  basePriceMinor: number;
  /** ref: opak, kiracıya özel referans (veritabanı kimliği değil). */
  variants: { ref: string; name: string; priceLabel: string; priceMinor: number; isDefault: boolean }[];
  modifierGroups: {
    ref: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    modifiers: { ref: string; name: string; priceDeltaMinor: number; priceDeltaLabel: string | null }[];
  }[];
  ingredients: string[];
  allergens: { code: string; name: string }[];
  /** İşletme alerjen bilgisini girdi mi? ("alerjen yok" ile "bilinmiyor" ayrımı) */
  allergenInfoDeclared: boolean;
  dietaryTags: { code: string; name: string }[];
  nutrition: { calories: number | null; proteinGrams: number | null; carbohydrateGrams: number | null; fatGrams: number | null } | null;
  /** Normalize edilmiş arama metni (ad, açıklama, malzemeler, kategori, etiketler). */
  search: string;
};

export type PublicCategoryView = {
  key: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Alt kategoriyse üst kategorinin anahtarı. */
  parentKey: string | null;
  products: PublicProductView[];
};

export type PublicTheme = {
  style: PublicMenuStyleKey;
  /** Marka rengi ve üzerindeki okunur metin rengi (kontrast güvenli). */
  brand: string;
  onBrand: string;
  /** Açık zemin üzerinde okunur vurgu rengi (etkin sekme, fiyat vurgusu). */
  accentText: string;
  welcomeText: string | null;
  heroImageUrl: string | null;
  logoUrl: string | null;
  show: { nutrition: boolean; allergens: boolean; ingredients: boolean; preparationTime: boolean; poweredBy: boolean };
};

export type PublicMenuView = {
  locale: MenuLocale;
  defaultLocale: string;
  direction: "ltr" | "rtl";
  availableLocales: MenuLocale[];
  restaurant: { name: string };
  branch: { name: string } | null;
  /** Güvenilir QR bağlamından (token) — istemci girdisinden ASLA. Önizlemede null. */
  table: { name: string; area: string | null } | null;
  categories: PublicCategoryView[];
  /** Öne çıkan ürünlerin anahtarları ("Popüler"). */
  featuredKeys: string[];
  /** Menüde gerçekten bulunan filtrelenebilir diyet etiketleri ve alerjenler. */
  filters: { dietary: { code: string; name: string }[]; allergens: { code: string; name: string }[] };
  theme: PublicTheme;
  /**
   * Sipariş verilebilir mi (yalnızca gerçek QR masa bağlamında; önizlemede null). scope: sepeti masaya bağlayan
   * opak değer — yetki değildir; gönderimde masa bağlamı sunucuda token'dan yeniden kurulur.
   */
  ordering: { scope: string; token: string; returnPath: string } | null;
};
