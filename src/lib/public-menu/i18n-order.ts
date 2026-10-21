import { isMenuLocale, type MenuLocale } from "@/config/menu";
import type { OrderStatus } from "@prisma/client";

/**
 * Sepet / sipariş arayüz metinleri (tr / en / de / ar). Teknik kod ya da hata ayrıntısı gösterilmez.
 * Arapça metinler örnek çeviridir — yayından önce anadili Arapça olan biri gözden geçirmeli.
 * Notlar mutfak isteğidir: alerjen güvencesi / mutfak garantisi ima edilmez.
 */
export type OrderStrings = {
  addToCart: (price: string) => string;
  updateItem: (price: string) => string;
  unavailable: string;
  quantity: string;
  decrease: (name: string) => string;
  increase: (name: string) => string;
  itemNote: string;
  itemNotePlaceholder: string;
  itemNoteHint: string;
  chooseVariant: string;
  chooseGroup: (group: string, min: number) => string;
  tooMany: (group: string, max: number) => string;
  cartBar: (count: number, total: string) => string;
  cartTitle: string;
  cartEmpty: string;
  cartEmptyHint: string;
  edit: string;
  remove: string;
  clearCart: string;
  clearCartConfirm: string;
  cancel: string;
  orderNote: string;
  orderNotePlaceholder: string;
  total: string;
  items: (n: number) => string;
  reviewOrder: string;
  confirmTitle: string;
  confirmHint: string;
  sendOrder: string;
  sending: string;
  back: string;
  successTitle: string;
  orderNumber: (n: string) => string;
  viewOrder: string;
  backToMenu: string;
  changedTitle: string;
  changedHint: string;
  lineSoldOut: string;
  lineUnavailable: string;
  lineInvalid: string;
  linePriceChanged: (from: string, to: string) => string;
  acceptChanges: string;
  checking: string;
  otherTableTitle: string;
  otherTableHint: (table: string, restaurant: string) => string;
  returnToTable: string;
  clearOtherCart: string;
  errorGeneric: string;
  errorContext: string;
  errorRateLimited: string;
  errorOrderingUnavailable: string;
  orderTitle: string;
  orderedAt: string;
  statusHeading: string;
  status: Record<OrderStatus, string>;
  statusHint: Partial<Record<OrderStatus, string>>;
  rejectionReason: string;
  /** Canlı durum göstergesi (yalnızca bağlantı sorununda görünür). */
  liveReconnecting: string;
  liveUpdated: string;
  myOrders: string;
  table: string;
};

const tr: OrderStrings = {
  addToCart: (p) => `Sepete ekle · ${p}`,
  updateItem: (p) => `Güncelle · ${p}`,
  unavailable: "Şu an sipariş verilemiyor",
  quantity: "Adet",
  decrease: (n) => `${n}: adedi azalt`,
  increase: (n) => `${n}: adedi artır`,
  itemNote: "Ürün notu",
  itemNotePlaceholder: "Ör. Soğan olmasın",
  itemNoteHint: "Mutfağa iletilen bir istektir; alerjen güvencesi değildir.",
  chooseVariant: "Bir seçenek seçin.",
  chooseGroup: (g, min) => `${g}: en az ${min} seçim yapın.`,
  tooMany: (g, max) => `${g}: en fazla ${max} seçim yapılabilir.`,
  cartBar: (c, t) => `Sepetim · ${c} ürün · ${t}`,
  cartTitle: "Sepetim",
  cartEmpty: "Sepetiniz boş",
  cartEmptyHint: "Menüden ürün ekleyerek başlayın.",
  edit: "Düzenle",
  remove: "Kaldır",
  clearCart: "Sepeti temizle",
  clearCartConfirm: "Sepetteki tüm ürünler silinsin mi?",
  cancel: "Vazgeç",
  orderNote: "Sipariş notu",
  orderNotePlaceholder: "Ör. Lütfen hepsi birlikte gelsin.",
  total: "Toplam",
  items: (n) => `${n} ürün`,
  reviewOrder: "Siparişi Onayla",
  confirmTitle: "Siparişi gönderiyorsunuz",
  confirmHint: "Gönderdikten sonra restoran siparişinizi onaylayacaktır.",
  sendOrder: "Siparişi Gönder",
  sending: "Gönderiliyor…",
  back: "Geri",
  successTitle: "Siparişiniz alındı",
  orderNumber: (n) => `Sipariş ${n}`,
  viewOrder: "Siparişi Gör",
  backToMenu: "Menüye Dön",
  changedTitle: "Menüde bazı bilgiler değişti.",
  changedHint: "Lütfen işaretli ürünleri kontrol edin. Toplam, onayınız olmadan değiştirilmez.",
  lineSoldOut: "Tükendi",
  lineUnavailable: "Artık mevcut değil",
  lineInvalid: "Seçenekler güncellenmeli",
  linePriceChanged: (f, t) => `Fiyat değişti: ${f} → ${t}`,
  acceptChanges: "Yeni tutarları kabul et",
  checking: "Güncel fiyatlar kontrol ediliyor…",
  otherTableTitle: "Bu sepet farklı bir masaya ait.",
  otherTableHint: (t, r) => `${r} · ${t} için hazırlanmış bir sepetiniz var. Bu masaya aktarılmaz.`,
  returnToTable: "O masaya dön",
  clearOtherCart: "O sepeti temizle",
  errorGeneric: "Sipariş gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.",
  errorContext: "Bu masanın QR kodu artık geçerli değil. Lütfen personelden yardım isteyin.",
  errorRateLimited: "Çok kısa sürede çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.",
  errorOrderingUnavailable: "Bu restoran şu anda masadan sipariş almıyor. Siparişiniz için garsondan yardım isteyebilirsiniz.",
  orderTitle: "Siparişiniz",
  orderedAt: "Sipariş zamanı",
  statusHeading: "Durum",
  status: {
    SUBMITTED: "Restoran onayı bekleniyor",
    ACCEPTED: "Restoran siparişinizi kabul etti",
    PREPARING: "Siparişiniz hazırlanıyor",
    READY: "Siparişiniz hazır",
    SERVED: "Servis edildi",
    CANCELLED: "Sipariş iptal edildi",
    REJECTED: "Sipariş kabul edilemedi",
  },
  statusHint: {
    SUBMITTED: "Siparişiniz restorana iletildi. Durum bu sayfada kendiliğinden güncellenir.",
    ACCEPTED: "Siparişiniz mutfağa iletildi.",
    PREPARING: "Mutfak siparişinizi hazırlıyor.",
    READY: "Siparişiniz birazdan masanıza getirilecek.",
    SERVED: "Afiyet olsun!",
    CANCELLED: "Lütfen personelle iletişime geçin.",
    REJECTED: "Lütfen personelle iletişime geçin.",
  },
  rejectionReason: "Açıklama",
  liveReconnecting: "Bağlantı yeniden kuruluyor…",
  liveUpdated: "Durum güncellendi",
  myOrders: "Siparişlerim",
  table: "Masa",
};

const en: OrderStrings = {
  addToCart: (p) => `Add to cart · ${p}`,
  updateItem: (p) => `Update · ${p}`,
  unavailable: "Not available to order right now",
  quantity: "Quantity",
  decrease: (n) => `${n}: decrease quantity`,
  increase: (n) => `${n}: increase quantity`,
  itemNote: "Item note",
  itemNotePlaceholder: "e.g. No onions",
  itemNoteHint: "A request to the kitchen; not an allergen guarantee.",
  chooseVariant: "Please choose an option.",
  chooseGroup: (g, min) => `${g}: choose at least ${min}.`,
  tooMany: (g, max) => `${g}: choose up to ${max}.`,
  cartBar: (c, t) => `My cart · ${c} ${c === 1 ? "item" : "items"} · ${t}`,
  cartTitle: "My cart",
  cartEmpty: "Your cart is empty",
  cartEmptyHint: "Add something from the menu to get started.",
  edit: "Edit",
  remove: "Remove",
  clearCart: "Clear cart",
  clearCartConfirm: "Remove all items from your cart?",
  cancel: "Cancel",
  orderNote: "Order note",
  orderNotePlaceholder: "e.g. Please serve everything together.",
  total: "Total",
  items: (n) => `${n} ${n === 1 ? "item" : "items"}`,
  reviewOrder: "Confirm order",
  confirmTitle: "You are about to send your order",
  confirmHint: "The restaurant will confirm your order after you send it.",
  sendOrder: "Send order",
  sending: "Sending…",
  back: "Back",
  successTitle: "Your order has been received",
  orderNumber: (n) => `Order ${n}`,
  viewOrder: "View order",
  backToMenu: "Back to menu",
  changedTitle: "Some menu details have changed.",
  changedHint: "Please check the highlighted items. Your total is never changed without your approval.",
  lineSoldOut: "Sold out",
  lineUnavailable: "No longer available",
  lineInvalid: "Options need updating",
  linePriceChanged: (f, t) => `Price changed: ${f} → ${t}`,
  acceptChanges: "Accept new prices",
  checking: "Checking current prices…",
  otherTableTitle: "This cart belongs to a different table.",
  otherTableHint: (t, r) => `You have a cart for ${r} · ${t}. It will not be moved to this table.`,
  returnToTable: "Go back to that table",
  clearOtherCart: "Clear that cart",
  errorGeneric: "Your order could not be sent. Please check your connection and try again.",
  errorContext: "This table's QR code is no longer valid. Please ask the staff for help.",
  errorRateLimited: "Too many attempts in a short time. Please try again shortly.",
  errorOrderingUnavailable: "This restaurant is not taking table orders right now. Please ask your server.",
  orderTitle: "Your order",
  orderedAt: "Ordered at",
  statusHeading: "Status",
  status: {
    SUBMITTED: "Waiting for the restaurant to confirm",
    ACCEPTED: "The restaurant accepted your order",
    PREPARING: "Your order is being prepared",
    READY: "Your order is ready",
    SERVED: "Served",
    CANCELLED: "The order was cancelled",
    REJECTED: "The order could not be accepted",
  },
  statusHint: {
    SUBMITTED: "Your order has been sent to the restaurant. This page updates automatically.",
    ACCEPTED: "Your order has been sent to the kitchen.",
    PREPARING: "The kitchen is preparing your order.",
    READY: "Your order will be brought to your table shortly.",
    SERVED: "Enjoy your meal!",
    CANCELLED: "Please speak to a member of staff.",
    REJECTED: "Please speak to a member of staff.",
  },
  rejectionReason: "Note",
  liveReconnecting: "Reconnecting…",
  liveUpdated: "Status updated",
  myOrders: "My orders",
  table: "Table",
};

const de: OrderStrings = {
  addToCart: (p) => `In den Warenkorb · ${p}`,
  updateItem: (p) => `Aktualisieren · ${p}`,
  unavailable: "Derzeit nicht bestellbar",
  quantity: "Menge",
  decrease: (n) => `${n}: Menge verringern`,
  increase: (n) => `${n}: Menge erhöhen`,
  itemNote: "Hinweis zum Gericht",
  itemNotePlaceholder: "z. B. ohne Zwiebeln",
  itemNoteHint: "Ein Wunsch an die Küche, keine Allergengarantie.",
  chooseVariant: "Bitte eine Variante wählen.",
  chooseGroup: (g, min) => `${g}: mindestens ${min} wählen.`,
  tooMany: (g, max) => `${g}: höchstens ${max} wählen.`,
  cartBar: (c, t) => `Warenkorb · ${c} Artikel · ${t}`,
  cartTitle: "Warenkorb",
  cartEmpty: "Ihr Warenkorb ist leer",
  cartEmptyHint: "Fügen Sie Gerichte aus der Speisekarte hinzu.",
  edit: "Bearbeiten",
  remove: "Entfernen",
  clearCart: "Warenkorb leeren",
  clearCartConfirm: "Alle Artikel aus dem Warenkorb entfernen?",
  cancel: "Abbrechen",
  orderNote: "Hinweis zur Bestellung",
  orderNotePlaceholder: "z. B. Bitte alles zusammen servieren.",
  total: "Gesamt",
  items: (n) => `${n} Artikel`,
  reviewOrder: "Bestellung bestätigen",
  confirmTitle: "Sie senden Ihre Bestellung",
  confirmHint: "Das Restaurant bestätigt Ihre Bestellung nach dem Senden.",
  sendOrder: "Bestellung senden",
  sending: "Wird gesendet…",
  back: "Zurück",
  successTitle: "Ihre Bestellung ist eingegangen",
  orderNumber: (n) => `Bestellung ${n}`,
  viewOrder: "Bestellung ansehen",
  backToMenu: "Zur Speisekarte",
  changedTitle: "Einige Angaben auf der Speisekarte haben sich geändert.",
  changedHint: "Bitte prüfen Sie die markierten Artikel. Der Betrag ändert sich nie ohne Ihre Zustimmung.",
  lineSoldOut: "Ausverkauft",
  lineUnavailable: "Nicht mehr verfügbar",
  lineInvalid: "Optionen müssen angepasst werden",
  linePriceChanged: (f, t) => `Preis geändert: ${f} → ${t}`,
  acceptChanges: "Neue Preise akzeptieren",
  checking: "Aktuelle Preise werden geprüft…",
  otherTableTitle: "Dieser Warenkorb gehört zu einem anderen Tisch.",
  otherTableHint: (t, r) => `Sie haben einen Warenkorb für ${r} · ${t}. Er wird nicht an diesen Tisch übertragen.`,
  returnToTable: "Zurück zu diesem Tisch",
  clearOtherCart: "Diesen Warenkorb leeren",
  errorGeneric: "Die Bestellung konnte nicht gesendet werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
  errorContext: "Der QR-Code dieses Tisches ist nicht mehr gültig. Bitte wenden Sie sich an das Personal.",
  errorRateLimited: "Zu viele Versuche in kurzer Zeit. Bitte versuchen Sie es gleich noch einmal.",
  errorOrderingUnavailable: "Dieses Restaurant nimmt derzeit keine Tischbestellungen an. Bitte wenden Sie sich an das Personal.",
  orderTitle: "Ihre Bestellung",
  orderedAt: "Bestellt um",
  statusHeading: "Status",
  status: {
    SUBMITTED: "Wartet auf Bestätigung des Restaurants",
    ACCEPTED: "Das Restaurant hat Ihre Bestellung angenommen",
    PREPARING: "Ihre Bestellung wird zubereitet",
    READY: "Ihre Bestellung ist fertig",
    SERVED: "Serviert",
    CANCELLED: "Die Bestellung wurde storniert",
    REJECTED: "Die Bestellung konnte nicht angenommen werden",
  },
  statusHint: {
    SUBMITTED: "Ihre Bestellung wurde an das Restaurant gesendet. Diese Seite aktualisiert sich automatisch.",
    ACCEPTED: "Ihre Bestellung wurde an die Küche weitergeleitet.",
    PREPARING: "Die Küche bereitet Ihre Bestellung zu.",
    READY: "Ihre Bestellung wird in Kürze an Ihren Tisch gebracht.",
    SERVED: "Guten Appetit!",
    CANCELLED: "Bitte wenden Sie sich an das Personal.",
    REJECTED: "Bitte wenden Sie sich an das Personal.",
  },
  rejectionReason: "Hinweis",
  liveReconnecting: "Verbindung wird wiederhergestellt…",
  liveUpdated: "Status aktualisiert",
  myOrders: "Meine Bestellungen",
  table: "Tisch",
};

const AR_PLURAL = new Intl.PluralRules("ar");
/** Arapça sayı uyumu: 1 → "منتج واحد", 2 → "منتجان", 3–10 → "… منتجات", 11–99 → "… منتجًا". */
export function arItems(n: number): string {
  switch (AR_PLURAL.select(n)) {
    case "zero":
      return "لا منتجات";
    case "one":
      return "منتج واحد";
    case "two":
      return "منتجان";
    case "few":
      return `${n} منتجات`;
    case "many":
      return `${n} منتجًا`;
    default:
      return `${n} منتج`;
  }
}

const ar: OrderStrings = {
  addToCart: (p) => `أضف إلى السلة · ${p}`,
  updateItem: (p) => `تحديث · ${p}`,
  unavailable: "غير متاح للطلب حالياً",
  quantity: "الكمية",
  decrease: (n) => `${n}: إنقاص الكمية`,
  increase: (n) => `${n}: زيادة الكمية`,
  itemNote: "ملاحظة على الطبق",
  itemNotePlaceholder: "مثال: بدون بصل",
  itemNoteHint: "طلب يُرسل إلى المطبخ، وليس ضماناً بخصوص مسببات الحساسية.",
  chooseVariant: "يرجى اختيار خيار.",
  chooseGroup: (g, min) => `${g}: اختر ${min} على الأقل.`,
  tooMany: (g, max) => `${g}: اختر ${max} كحد أقصى.`,
  cartBar: (c, t) => `سلتي · ${arItems(c)} · ${t}`,
  cartTitle: "سلتي",
  cartEmpty: "سلتك فارغة",
  cartEmptyHint: "ابدأ بإضافة أطباق من القائمة.",
  edit: "تعديل",
  remove: "إزالة",
  clearCart: "إفراغ السلة",
  clearCartConfirm: "هل تريد حذف جميع المنتجات من السلة؟",
  cancel: "إلغاء",
  orderNote: "ملاحظة على الطلب",
  orderNotePlaceholder: "مثال: يرجى تقديم كل شيء معاً.",
  total: "الإجمالي",
  items: (n) => arItems(n),
  reviewOrder: "تأكيد الطلب",
  confirmTitle: "أنت على وشك إرسال طلبك",
  confirmHint: "سيؤكد المطعم طلبك بعد إرساله.",
  sendOrder: "إرسال الطلب",
  sending: "جارٍ الإرسال…",
  back: "رجوع",
  successTitle: "تم استلام طلبك",
  orderNumber: (n) => `الطلب ${n}`,
  viewOrder: "عرض الطلب",
  backToMenu: "العودة إلى القائمة",
  changedTitle: "تغيّرت بعض معلومات القائمة.",
  changedHint: "يرجى مراجعة المنتجات المحددة. لن يتغير المبلغ دون موافقتك.",
  lineSoldOut: "نفد",
  lineUnavailable: "لم يعد متاحاً",
  lineInvalid: "يجب تحديث الخيارات",
  linePriceChanged: (f, t) => `تغيّر السعر: ${f} ← ${t}`,
  acceptChanges: "قبول الأسعار الجديدة",
  checking: "جارٍ التحقق من الأسعار الحالية…",
  otherTableTitle: "هذه السلة تخص طاولة أخرى.",
  otherTableHint: (t, r) => `لديك سلة لـ ${r} · ${t}. لن تُنقل إلى هذه الطاولة.`,
  returnToTable: "العودة إلى تلك الطاولة",
  clearOtherCart: "إفراغ تلك السلة",
  errorGeneric: "تعذّر إرسال الطلب. يرجى التحقق من الاتصال والمحاولة مرة أخرى.",
  errorContext: "رمز QR لهذه الطاولة لم يعد صالحاً. يرجى طلب المساعدة من الموظفين.",
  errorRateLimited: "محاولات كثيرة في وقت قصير. يرجى المحاولة بعد قليل.",
  errorOrderingUnavailable: "هذا المطعم لا يستقبل الطلبات من الطاولة حاليًا. يرجى طلب المساعدة من النادل.",
  orderTitle: "طلبك",
  orderedAt: "وقت الطلب",
  statusHeading: "الحالة",
  status: {
    SUBMITTED: "بانتظار تأكيد المطعم",
    ACCEPTED: "قبل المطعم طلبك",
    PREPARING: "طلبك قيد التحضير",
    READY: "طلبك جاهز",
    SERVED: "تم التقديم",
    CANCELLED: "أُلغي الطلب",
    REJECTED: "تعذّر قبول الطلب",
  },
  statusHint: {
    SUBMITTED: "أُرسل طلبك إلى المطعم. تُحدَّث هذه الصفحة تلقائيًا.",
    ACCEPTED: "أُرسل طلبك إلى المطبخ.",
    PREPARING: "يحضّر المطبخ طلبك.",
    READY: "سيُقدَّم طلبك إلى طاولتك قريبًا.",
    SERVED: "بالهناء والشفاء!",
    CANCELLED: "يرجى التحدث إلى أحد الموظفين.",
    REJECTED: "يرجى التحدث إلى أحد الموظفين.",
  },
  rejectionReason: "ملاحظة",
  liveReconnecting: "جارٍ إعادة الاتصال…",
  liveUpdated: "تم تحديث الحالة",
  myOrders: "طلباتي",
  table: "طاولة",
};

const STRINGS: Record<MenuLocale, OrderStrings> = { tr, en, de, ar };

export function orderStrings(locale: string): OrderStrings {
  return isMenuLocale(locale) ? STRINGS[locale] : tr;
}
