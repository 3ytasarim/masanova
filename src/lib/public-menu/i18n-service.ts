import type { ServiceRequestStatus, ServiceRequestType } from "@prisma/client";
import { isMenuLocale, type MenuLocale } from "@/config/menu";

/**
 * Müşteri servis talebi metinleri (tr / en / de / ar). Hesap talebi ödeme DEĞİLDİR — metinler ödeme yapıldığını ima etmez.
 * Arapça metinler örnek çeviridir — yayından önce anadili Arapça olan biri gözden geçirmeli.
 */
export type ServiceStrings = {
  button: string;
  title: string;
  subtitle: string;
  types: Record<ServiceRequestType, string>;
  confirm: Record<ServiceRequestType, string>;
  confirmAction: Record<ServiceRequestType, string>;
  customLabel: string;
  customPlaceholder: string;
  customHint: string;
  cancel: string;
  close: string;
  sending: string;
  sent: Record<ServiceRequestType, string>;
  alreadySent: Record<ServiceRequestType, string>;
  status: (status: ServiceRequestStatus, staffName: string | null) => string;
  activeTitle: string;
  withdraw: string;
  errorGeneric: string;
  errorContext: string;
  errorRateLimited: string;
  reconnecting: string;
};

const tr: ServiceStrings = {
  button: "Servis",
  title: "Servis İste",
  subtitle: "Talebiniz anında personele iletilir.",
  types: { WAITER: "Garson Çağır", WATER: "Su İste", NAPKIN: "Peçete İste", BILL: "Hesap İste", CUSTOM: "Diğer" },
  confirm: {
    WAITER: "Garson çağırmak istediğinize emin misiniz?",
    WATER: "Masanıza su getirilsin mi?",
    NAPKIN: "Masanıza peçete getirilsin mi?",
    BILL: "Hesap istemek istediğinize emin misiniz?",
    CUSTOM: "İsteğinizi kısaca yazın",
  },
  confirmAction: { WAITER: "Garsonu Çağır", WATER: "Su İste", NAPKIN: "Peçete İste", BILL: "Hesabı İste", CUSTOM: "Gönder" },
  customLabel: "İsteğiniz",
  customPlaceholder: "Ör. Çocuk sandalyesi rica edebilir miyiz?",
  customHint: "Kısa bir not yeterli. Kişisel bilgi yazmayın.",
  cancel: "Vazgeç",
  close: "Kapat",
  sending: "Gönderiliyor…",
  sent: {
    WAITER: "Garson çağrınız iletildi.",
    WATER: "Su talebiniz iletildi.",
    NAPKIN: "Peçete talebiniz iletildi.",
    BILL: "Hesap talebiniz iletildi.",
    CUSTOM: "İsteğiniz iletildi.",
  },
  alreadySent: {
    WAITER: "Garson çağrınız zaten iletildi.",
    WATER: "Su talebiniz zaten iletildi.",
    NAPKIN: "Peçete talebiniz zaten iletildi.",
    BILL: "Hesap talebiniz zaten iletildi.",
    CUSTOM: "Bu talebiniz zaten iletildi.",
  },
  status: (s, name) =>
    s === "OPEN" ? "Talebiniz personele iletildi." : s === "ACKNOWLEDGED" ? (name ? `${name} talebinizle ilgileniyor.` : "Talebinizle ilgileniliyor.") : s === "COMPLETED" ? "Talebiniz tamamlandı." : "Talep iptal edildi.",
  activeTitle: "Talepleriniz",
  withdraw: "Geri al",
  errorGeneric: "Talebiniz gönderilemedi. Lütfen tekrar deneyin.",
  errorContext: "Bu masanın QR kodu artık geçerli değil. Lütfen personelden yardım isteyin.",
  errorRateLimited: "Çok kısa sürede çok fazla talep gönderildi. Lütfen biraz bekleyin.",
  reconnecting: "Bağlantı yeniden kuruluyor…",
};

const en: ServiceStrings = {
  button: "Service",
  title: "Request Service",
  subtitle: "Your request goes straight to the staff.",
  types: { WAITER: "Call Waiter", WATER: "Water", NAPKIN: "Napkins", BILL: "Request Bill", CUSTOM: "Other" },
  confirm: {
    WAITER: "Do you want to call a waiter?",
    WATER: "Should we bring water to your table?",
    NAPKIN: "Should we bring napkins to your table?",
    BILL: "Do you want to request the bill?",
    CUSTOM: "Briefly describe your request",
  },
  confirmAction: { WAITER: "Call Waiter", WATER: "Request Water", NAPKIN: "Request Napkins", BILL: "Request Bill", CUSTOM: "Send" },
  customLabel: "Your request",
  customPlaceholder: "e.g. Could we have a high chair?",
  customHint: "A short note is enough. Please don't include personal details.",
  cancel: "Cancel",
  close: "Close",
  sending: "Sending…",
  sent: {
    WAITER: "Your waiter call has been sent.",
    WATER: "Your water request has been sent.",
    NAPKIN: "Your napkin request has been sent.",
    BILL: "Your bill request has been sent.",
    CUSTOM: "Your request has been sent.",
  },
  alreadySent: {
    WAITER: "You have already called a waiter.",
    WATER: "Your water request has already been sent.",
    NAPKIN: "Your napkin request has already been sent.",
    BILL: "Your bill request has already been sent.",
    CUSTOM: "This request has already been sent.",
  },
  status: (s, name) =>
    s === "OPEN" ? "Your request has been sent to the staff." : s === "ACKNOWLEDGED" ? (name ? `${name} is handling your request.` : "Your request is being handled.") : s === "COMPLETED" ? "Your request has been completed." : "Request cancelled.",
  activeTitle: "Your requests",
  withdraw: "Withdraw",
  errorGeneric: "Your request could not be sent. Please try again.",
  errorContext: "This table's QR code is no longer valid. Please ask a member of staff.",
  errorRateLimited: "Too many requests in a short time. Please wait a moment.",
  reconnecting: "Reconnecting…",
};

const de: ServiceStrings = {
  button: "Service",
  title: "Service anfordern",
  subtitle: "Ihre Anfrage geht direkt an das Personal.",
  types: { WAITER: "Kellner rufen", WATER: "Wasser", NAPKIN: "Servietten", BILL: "Rechnung", CUSTOM: "Sonstiges" },
  confirm: {
    WAITER: "Möchten Sie einen Kellner rufen?",
    WATER: "Sollen wir Wasser an Ihren Tisch bringen?",
    NAPKIN: "Sollen wir Servietten an Ihren Tisch bringen?",
    BILL: "Möchten Sie die Rechnung anfordern?",
    CUSTOM: "Beschreiben Sie Ihren Wunsch kurz",
  },
  confirmAction: { WAITER: "Kellner rufen", WATER: "Wasser anfordern", NAPKIN: "Servietten anfordern", BILL: "Rechnung anfordern", CUSTOM: "Senden" },
  customLabel: "Ihr Wunsch",
  customPlaceholder: "z. B. Könnten wir einen Kinderstuhl bekommen?",
  customHint: "Eine kurze Notiz genügt. Bitte keine persönlichen Daten angeben.",
  cancel: "Abbrechen",
  close: "Schließen",
  sending: "Wird gesendet…",
  sent: {
    WAITER: "Ihr Kellnerruf wurde gesendet.",
    WATER: "Ihre Wasser-Anfrage wurde gesendet.",
    NAPKIN: "Ihre Servietten-Anfrage wurde gesendet.",
    BILL: "Ihre Rechnungsanfrage wurde gesendet.",
    CUSTOM: "Ihre Anfrage wurde gesendet.",
  },
  alreadySent: {
    WAITER: "Sie haben bereits einen Kellner gerufen.",
    WATER: "Ihre Wasser-Anfrage wurde bereits gesendet.",
    NAPKIN: "Ihre Servietten-Anfrage wurde bereits gesendet.",
    BILL: "Ihre Rechnungsanfrage wurde bereits gesendet.",
    CUSTOM: "Diese Anfrage wurde bereits gesendet.",
  },
  status: (s, name) =>
    s === "OPEN" ? "Ihre Anfrage wurde an das Personal gesendet." : s === "ACKNOWLEDGED" ? (name ? `${name} kümmert sich um Ihre Anfrage.` : "Ihre Anfrage wird bearbeitet.") : s === "COMPLETED" ? "Ihre Anfrage wurde erledigt." : "Anfrage storniert.",
  activeTitle: "Ihre Anfragen",
  withdraw: "Zurückziehen",
  errorGeneric: "Ihre Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
  errorContext: "Der QR-Code dieses Tisches ist nicht mehr gültig. Bitte wenden Sie sich an das Personal.",
  errorRateLimited: "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment.",
  reconnecting: "Verbindung wird wiederhergestellt…",
};

const ar: ServiceStrings = {
  button: "الخدمة",
  title: "طلب خدمة",
  subtitle: "يصل طلبك إلى الموظفين مباشرة.",
  types: { WAITER: "استدعاء النادل", WATER: "ماء", NAPKIN: "مناديل", BILL: "طلب الحساب", CUSTOM: "أخرى" },
  confirm: {
    WAITER: "هل تريد استدعاء النادل؟",
    WATER: "هل نحضر الماء إلى طاولتك؟",
    NAPKIN: "هل نحضر المناديل إلى طاولتك؟",
    BILL: "هل تريد طلب الحساب؟",
    CUSTOM: "اكتب طلبك باختصار",
  },
  confirmAction: { WAITER: "استدعاء النادل", WATER: "طلب الماء", NAPKIN: "طلب المناديل", BILL: "طلب الحساب", CUSTOM: "إرسال" },
  customLabel: "طلبك",
  customPlaceholder: "مثال: هل يمكننا الحصول على كرسي للأطفال؟",
  customHint: "تكفي ملاحظة قصيرة. يرجى عدم كتابة معلومات شخصية.",
  cancel: "إلغاء",
  close: "إغلاق",
  sending: "جارٍ الإرسال…",
  sent: {
    WAITER: "تم إرسال استدعاء النادل.",
    WATER: "تم إرسال طلب الماء.",
    NAPKIN: "تم إرسال طلب المناديل.",
    BILL: "تم إرسال طلب الحساب.",
    CUSTOM: "تم إرسال طلبك.",
  },
  alreadySent: {
    WAITER: "لقد استدعيت النادل بالفعل.",
    WATER: "تم إرسال طلب الماء مسبقًا.",
    NAPKIN: "تم إرسال طلب المناديل مسبقًا.",
    BILL: "تم إرسال طلب الحساب مسبقًا.",
    CUSTOM: "تم إرسال هذا الطلب مسبقًا.",
  },
  status: (s, name) => (s === "OPEN" ? "تم إرسال طلبك إلى الموظفين." : s === "ACKNOWLEDGED" ? (name ? `${name} يتابع طلبك.` : "جارٍ التعامل مع طلبك.") : s === "COMPLETED" ? "تم إنجاز طلبك." : "أُلغي الطلب."),
  activeTitle: "طلباتك",
  withdraw: "سحب الطلب",
  errorGeneric: "تعذّر إرسال طلبك. يرجى المحاولة مرة أخرى.",
  errorContext: "رمز QR لهذه الطاولة لم يعد صالحًا. يرجى طلب المساعدة من الموظفين.",
  errorRateLimited: "طلبات كثيرة في وقت قصير. يرجى الانتظار قليلًا.",
  reconnecting: "جارٍ إعادة الاتصال…",
};

const STRINGS: Record<MenuLocale, ServiceStrings> = { tr, en, de, ar };

export function serviceStrings(locale: string): ServiceStrings {
  return STRINGS[isMenuLocale(locale) ? locale : "tr"];
}
