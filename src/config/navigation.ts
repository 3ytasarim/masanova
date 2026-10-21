import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Building2,
  ChefHat,
  CalendarClock,
  CreditCard,
  Receipt,
  Gift,
  Megaphone,
  Globe,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  MapPin,
  Package,
  Palette,
  ScrollText,
  Settings,
  ShoppingBag,
  Sparkles,
  Table2,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Feature } from "@/config/plans";
import type { Permission } from "@/lib/permissions/roles";

/**
 * Admin ve panel gezinme tanımları — menü, sayfa başlıkları ve "yakında" bölümleri tek kaynaktan okunur.
 * `sprint`: bölümün planlandığı sprint (yer tutucu sayfalarda gösterilir).
 */
export type NavItem = {
  /** URL segmenti ("" = alanın kök sayfası). */
  segment: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission?: Permission;
  sprint?: string;
  /**
   * Sprint 20 — paket özelliği. Kiracıda yoksa menüde KİLİTLİ (paket rozetiyle) görünür; sayfa davranışı `lockMode`:
   *   "screen"   → yükseltme ekranı (yeni işlem anlamsız: analitik, kampanya, sadakat ayarları)
   *   "continue" → mevcut kayıtlar görüntülenir / tamamlanır, yeni oluşturma sunucuda reddedilir (devam politikası)
   */
  feature?: Feature;
  lockMode?: "screen" | "continue";
};

export type NavArea = "admin" | "panel";

export const AREA_BASE_PATH: Record<NavArea, "/admin" | "/panel"> = { admin: "/admin", panel: "/panel" };

export const adminNav: readonly NavItem[] = [
  { segment: "", label: "Genel Bakış", description: "Platform genelindeki işletme ve sistem durumu.", icon: LayoutDashboard },
  { segment: "isletmeler", label: "İşletmeler", description: "Kiracı işletmelerin oluşturulması, durumu ve yaşam döngüsü.", icon: Building2 },
  { segment: "subeler", label: "Şubeler", description: "Tüm işletmelerin şubeleri ve konumları.", icon: MapPin },
  { segment: "paketler", label: "Paketler", description: "Abonelik paketleri, özellik bayrakları ve limitler.", icon: Package, sprint: "Sprint 6" },
  { segment: "abonelikler", label: "Abonelikler", description: "İşletme abonelikleri, deneme ve ek süreler (manuel faturalama).", icon: CreditCard },
  { segment: "domainler", label: "Domainler", description: "Alt alan adları, özel alan adları ve DNS doğrulaması.", icon: Globe },
  { segment: "demo-talepleri", label: "Demo Talepleri", description: "Landing sayfasından gelen demo talepleri.", icon: Inbox },
  { segment: "yapay-zeka-egitimi", label: "Yapay Zeka Eğit", description: "Tüm işletmelerin sesli garsonuna öğretilen sağlık, beslenme ve kalori bilgileri.", icon: GraduationCap },
  { segment: "ai-kullanimi", label: "AI Kullanımı", description: "İşletme bazında AI konuşma, token ve ses kullanımı (yalnızca meta veri).", icon: Sparkles },
  { segment: "sistem", label: "Sistem", description: "Veritabanı, servis durumu ve platform yapılandırması.", icon: Activity },
  { segment: "audit-logs", label: "Audit Logs", description: "Platform genelindeki denetim kayıtları.", icon: ScrollText },
];

export const panelNav: readonly NavItem[] = [
  { segment: "", label: "Genel Bakış", description: "İşletmenizin bugünkü durumu.", icon: LayoutDashboard, permission: "panel.view" },
  { segment: "siparisler", label: "Siparişler", description: "QR masa siparişleri: liste, ayrıntı, kabul / ret.", icon: ShoppingBag, permission: "orders.view", feature: "ordering", lockMode: "continue" },
  { segment: "odemeler", label: "Ödemeler", description: "Online ve kasada alınan ödemeler, iadeler, bölünmüş hesaplar ve ödeme ayarları.", icon: CreditCard, permission: "payments.view", feature: "restaurant_payments", lockMode: "continue" },
  { segment: "menu", label: "Menü", description: "Kategoriler, ürünler, varyantlar, ekstralar, alerjenler ve çeviriler.", icon: Boxes, permission: "menu.view" },
  { segment: "masalar", label: "Masalar & QR", description: "Bölgeler, masalar, güvenli QR kodları ve baskıya hazır etiketler.", icon: Table2, permission: "tables.view" },
  { segment: "mutfak", label: "Mutfak", description: "Mutfak ekranı (KDS), istasyon fişleri ve hazırlık akışı.", icon: ChefHat, permission: "kds.view", feature: "kds", lockMode: "continue" },
  { segment: "servis", label: "Servis", description: "Garson çağrıları, su / peçete / hesap ve özel istekler.", icon: Bell, permission: "service.view", feature: "service_requests", lockMode: "continue" },
  { segment: "rezervasyonlar", label: "Rezervasyonlar", description: "Bugünün gelişleri, zaman çizelgesi, takvim, walk-in ve masa planı.", icon: CalendarClock, permission: "reservations.view", feature: "reservations", lockMode: "continue" },
  { segment: "musteriler", label: "Müşteriler", description: "Kendi isteğiyle katılan müşteriler, onaylar ve sipariş geçmişi.", icon: Users, permission: "crm.view", feature: "crm", lockMode: "continue" },
  { segment: "kampanyalar", label: "Kampanyalar", description: "Kuponlar, sadakat ödülleri ve izin odaklı kampanya taslakları.", icon: Megaphone, permission: "campaigns.view", feature: "promotions", lockMode: "screen" },
  { segment: "sadakat", label: "Sadakat", description: "Sadakat programı: aç / kapa, puan kuralı ve üye özeti.", icon: Gift, permission: "loyalty.view", feature: "loyalty", lockMode: "screen" },
  { segment: "ai", label: "AI Asistan", description: "Sesli AI asistan ayarları ve kullanım.", icon: Bot, permission: "ai.manage", feature: "voice_ai", lockMode: "continue" },
  { segment: "analitik", label: "Analitik", description: "Sipariş tutarı, ürün performansı, masa / bölge, mutfak, servis ve AI kullanımı.", icon: BarChart3, permission: "analytics.view", feature: "analytics", lockMode: "screen" },
  { segment: "tema", label: "Tema & Tasarım", description: "QR menü düzeni, marka renkleri, kapak görseli ve görünürlük ayarları.", icon: Palette, permission: "branding.manage" },
  { segment: "abonelik", label: "Abonelik", description: "Paketiniz, abonelik durumu, özellikler, limitler ve kullanım.", icon: Receipt, permission: "billing.view" },
  { segment: "personel", label: "Personel", description: "Personel hesapları, roller, aktiflik ve parola sıfırlama.", icon: UserCog, permission: "staff.manage" },
  { segment: "ayarlar", label: "Ayarlar", description: "İşletme bilgileri, şubeler, para birimi ve dil.", icon: Settings, permission: "settings.manage" },
];

export const NAV_BY_AREA: Record<NavArea, readonly NavItem[]> = { admin: adminNav, panel: panelNav };

export function navHref(area: NavArea, item: NavItem): string {
  return item.segment ? `${AREA_BASE_PATH[area]}/${item.segment}` : AREA_BASE_PATH[area];
}

/** Gezinme durumu (merkezi): izin yoksa gizli; özellik yoksa kilitli (paket rozeti); aksi halde görünür. */
export type NavState = "visible" | "locked" | "hidden";
export function navState(item: NavItem, input: { permissions?: readonly Permission[]; features?: readonly Feature[] }): NavState {
  if (item.permission && input.permissions && !input.permissions.includes(item.permission)) return "hidden";
  if (item.feature && input.features && !input.features.includes(item.feature)) return "locked";
  return "visible";
}

export function findNavItem(area: NavArea, segment: string): NavItem | undefined {
  return NAV_BY_AREA[area].find((item) => item.segment === segment);
}
