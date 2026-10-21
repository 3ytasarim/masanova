/**
 * Menü analitiği TEMELİ (Sprint 5: yalnızca tipli arayüz; kalıcı kayıt bilinçli olarak ertelendi).
 *
 * Gizlilik ilkeleri: kişisel tanımlayıcı yok (IP, cihaz kimliği, çerez, parmak izi tutulmaz), arama metni
 * gönderilmez (yalnızca uzunluğu / sonuç sayısı), masa/kiracı bilgisi istemciden değil sunucudaki güvenilir QR
 * bağlamından eklenecek. Kalıcılık eklendiğinde: anonim, günlük toplu sayaçlar (ör. ürün başına detay açılma).
 */
export type MenuEvent =
  | { type: "menu_opened"; locale: string }
  | { type: "category_viewed"; category: string }
  | { type: "product_opened"; product: string }
  | { type: "search_used"; queryLength: number; results: number }
  | { type: "language_changed"; from: string; to: string }
  // Sprint 6 — sepet / sipariş (kişisel veri yok; tutar ve adet toplu)
  | { type: "add_to_cart"; product: string; quantity: number }
  | { type: "remove_from_cart"; product: string }
  | { type: "view_cart"; lines: number }
  | { type: "begin_checkout"; items: number }
  | { type: "order_submitted"; items: number; duplicate: boolean };

export const MENU_EVENT_NAME = "masanova:menu-event";

/**
 * Şimdilik yalnızca tarayıcı içi bir olay yayınlar (ağ isteği yok, çerez yok). Gelecekte burada toplu ve
 * anonim bir gönderim (navigator.sendBeacon) yapılacak.
 */
export function trackMenuEvent(event: MenuEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MenuEvent>(MENU_EVENT_NAME, { detail: event }));
}
