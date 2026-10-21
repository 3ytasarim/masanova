import type { ServiceRequestType } from "@prisma/client";
import { AI_CTA } from "@/lib/ai/cta";
import type { AiLanguage } from "@/lib/voice/language-detection";

/**
 * Sesli asistan arayüz metinleri (tr / en / de / ar / ru). Asistan paneli KONUŞMA dilini izler (menü dilinden bağımsız).
 * Arapça ve Rusça metinler örnek çeviridir — yayından önce anadili konuşan biri gözden geçirmeli.
 */
type ServiceKind = Exclude<ServiceRequestType, "CUSTOM">;

export type AssistantStrings = {
  cta: string;
  title: string;
  ready: string;
  listening: string;
  thinking: string;
  preparing: string;
  speaking: string;
  tapToTalk: string;
  stopTalking: string;
  interrupt: string;
  typeInstead: string;
  placeholder: string;
  send: string;
  mute: string;
  unmute: string;
  replay: string;
  stopSpeaking: string;
  close: string;
  privacy: string;
  recording: string;
  you: string;
  micDenied: string;
  micUnsupported: string;
  sttFailed: string;
  aiFailed: string;
  rateLimited: string;
  tooLong: string;
  repeat: string;
  disabled: string;
  addToCart: string;
  cancel: string;
  openProduct: string;
  prepareCart: string;
  openCart: string;
  update: string;
  remove: string;
  total: string;
  added: string;
  updated: string;
  dismissed: string;
  chooseOptions: string;
  service: Record<ServiceKind, string>;
  serviceSent: Record<ServiceKind, string>;
  serviceAlready: Record<ServiceKind, string>;
  menuInLanguage: (language: string) => string;
};

const tr: AssistantStrings = {
  cta: AI_CTA.tr,
  title: "MasaNova AI",
  ready: "Size nasıl yardımcı olabilirim?",
  listening: "Dinliyorum…",
  thinking: "Anlıyorum…",
  preparing: "Yanıt hazırlanıyor…",
  speaking: "Konuşuyor…",
  tapToTalk: "Konuşmak için dokunun",
  stopTalking: "Konuşmayı Bitir",
  interrupt: "Sözü kes ve konuş",
  typeInstead: "Yaz",
  placeholder: "Sorunuzu yazın…",
  send: "Gönder",
  mute: "Sesi Kapat",
  unmute: "Sesi Aç",
  replay: "Tekrar dinle",
  stopSpeaking: "Durdur",
  close: "Kapat",
  privacy: "Mikrofon yalnızca siz dokunduğunuzda açılır; ses kaydı saklanmaz.",
  recording: "Ses kaydediliyor",
  you: "Siz",
  micDenied: "Mikrofon izni verilmedi. İsterseniz yazarak devam edebilirsiniz.",
  micUnsupported: "Bu tarayıcı ses kaydını desteklemiyor. Yazarak devam edebilirsiniz.",
  sttFailed: "Sesinizi anlayamadım. Tekrar deneyebilir veya yazarak devam edebilirsiniz.",
  aiFailed: "Asistan şu anda yanıt veremiyor. Menüyü kullanmaya devam edebilirsiniz.",
  rateLimited: "Çok kısa sürede çok fazla istek gönderildi. Lütfen biraz bekleyin.",
  tooLong: "Mesaj çok uzun. Lütfen daha kısa söyleyin.",
  repeat: "Lütfen tekrar eder misiniz?",
  disabled: "Asistan şu anda kullanılamıyor.",
  addToCart: "Sepete Ekle",
  cancel: "Vazgeç",
  openProduct: "Ürünü Aç",
  prepareCart: "Sepete Hazırla",
  openCart: "Sepeti Aç",
  update: "Güncelle",
  remove: "Sepetten Çıkar",
  total: "Toplam",
  added: "Sepete eklendi.",
  updated: "Sepet güncellendi.",
  dismissed: "Vazgeçildi.",
  chooseOptions: "Seçim gerekli",
  service: { WAITER: "Garson Çağır", WATER: "Su İste", NAPKIN: "Peçete İste", BILL: "Hesap İste" },
  serviceSent: { WAITER: "Garson çağrınız iletildi.", WATER: "Su talebiniz iletildi.", NAPKIN: "Peçete talebiniz iletildi.", BILL: "Hesap talebiniz iletildi." },
  serviceAlready: { WAITER: "Garson çağrınız zaten iletildi.", WATER: "Su talebiniz zaten iletildi.", NAPKIN: "Peçete talebiniz zaten iletildi.", BILL: "Hesap talebiniz zaten iletildi." },
  menuInLanguage: (l) => `Menüyü de ${l} göster`,
};

const en: AssistantStrings = {
  cta: AI_CTA.en,
  title: "MasaNova AI",
  ready: "How can I help you?",
  listening: "Listening…",
  thinking: "Understanding…",
  preparing: "Preparing a reply…",
  speaking: "Speaking…",
  tapToTalk: "Tap to talk",
  stopTalking: "Done Talking",
  interrupt: "Interrupt and talk",
  typeInstead: "Type",
  placeholder: "Type your question…",
  send: "Send",
  mute: "Mute Voice",
  unmute: "Unmute",
  replay: "Replay",
  stopSpeaking: "Stop",
  close: "Close",
  privacy: "The microphone only opens when you tap; recordings are not stored.",
  recording: "Recording",
  you: "You",
  micDenied: "Microphone permission was not granted. You can continue by typing.",
  micUnsupported: "This browser doesn't support voice recording. You can continue by typing.",
  sttFailed: "I couldn't understand that. Please try again or type instead.",
  aiFailed: "The assistant can't reply right now. You can keep using the menu.",
  rateLimited: "Too many requests in a short time. Please wait a moment.",
  tooLong: "That message is too long. Please keep it shorter.",
  repeat: "Could you say that again, please?",
  disabled: "The assistant is not available right now.",
  addToCart: "Add to Cart",
  cancel: "Cancel",
  openProduct: "Open Dish",
  prepareCart: "Prepare Cart",
  openCart: "Open Cart",
  update: "Update",
  remove: "Remove from Cart",
  total: "Total",
  added: "Added to your cart.",
  updated: "Cart updated.",
  dismissed: "Cancelled.",
  chooseOptions: "Choice required",
  service: { WAITER: "Call Waiter", WATER: "Request Water", NAPKIN: "Request Napkins", BILL: "Request Bill" },
  serviceSent: { WAITER: "Your waiter call has been sent.", WATER: "Your water request has been sent.", NAPKIN: "Your napkin request has been sent.", BILL: "Your bill request has been sent." },
  serviceAlready: { WAITER: "You have already called a waiter.", WATER: "Your water request was already sent.", NAPKIN: "Your napkin request was already sent.", BILL: "Your bill request was already sent." },
  menuInLanguage: (l) => `Show the menu in ${l} too`,
};

const de: AssistantStrings = {
  cta: AI_CTA.de,
  title: "MasaNova AI",
  ready: "Wie kann ich Ihnen helfen?",
  listening: "Ich höre zu…",
  thinking: "Ich verstehe…",
  preparing: "Antwort wird vorbereitet…",
  speaking: "Spricht…",
  tapToTalk: "Zum Sprechen tippen",
  stopTalking: "Fertig gesprochen",
  interrupt: "Unterbrechen und sprechen",
  typeInstead: "Tippen",
  placeholder: "Frage eingeben…",
  send: "Senden",
  mute: "Ton aus",
  unmute: "Ton an",
  replay: "Erneut anhören",
  stopSpeaking: "Stopp",
  close: "Schließen",
  privacy: "Das Mikrofon öffnet sich nur, wenn Sie tippen; Aufnahmen werden nicht gespeichert.",
  recording: "Aufnahme",
  you: "Sie",
  micDenied: "Mikrofonzugriff wurde nicht erlaubt. Sie können per Text fortfahren.",
  micUnsupported: "Dieser Browser unterstützt keine Sprachaufnahme. Sie können per Text fortfahren.",
  sttFailed: "Ich habe Sie nicht verstanden. Bitte erneut versuchen oder tippen.",
  aiFailed: "Der Assistent kann gerade nicht antworten. Die Speisekarte funktioniert weiterhin.",
  rateLimited: "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment.",
  tooLong: "Die Nachricht ist zu lang. Bitte kürzer formulieren.",
  repeat: "Könnten Sie das bitte wiederholen?",
  disabled: "Der Assistent ist derzeit nicht verfügbar.",
  addToCart: "In den Warenkorb",
  cancel: "Abbrechen",
  openProduct: "Gericht öffnen",
  prepareCart: "Warenkorb vorbereiten",
  openCart: "Warenkorb öffnen",
  update: "Aktualisieren",
  remove: "Entfernen",
  total: "Gesamt",
  added: "Zum Warenkorb hinzugefügt.",
  updated: "Warenkorb aktualisiert.",
  dismissed: "Abgebrochen.",
  chooseOptions: "Auswahl erforderlich",
  service: { WAITER: "Kellner rufen", WATER: "Wasser anfordern", NAPKIN: "Servietten anfordern", BILL: "Rechnung anfordern" },
  serviceSent: { WAITER: "Ihr Kellnerruf wurde gesendet.", WATER: "Ihre Wasser-Anfrage wurde gesendet.", NAPKIN: "Ihre Servietten-Anfrage wurde gesendet.", BILL: "Ihre Rechnungsanfrage wurde gesendet." },
  serviceAlready: { WAITER: "Sie haben bereits einen Kellner gerufen.", WATER: "Wasser wurde bereits angefordert.", NAPKIN: "Servietten wurden bereits angefordert.", BILL: "Die Rechnung wurde bereits angefordert." },
  menuInLanguage: (l) => `Speisekarte auch auf ${l} anzeigen`,
};

const ar: AssistantStrings = {
  cta: AI_CTA.ar,
  title: "MasaNova AI",
  ready: "كيف يمكنني مساعدتك؟",
  listening: "أستمع…",
  thinking: "أفهم طلبك…",
  preparing: "جارٍ تحضير الرد…",
  speaking: "يتحدث…",
  tapToTalk: "اضغط للتحدث",
  stopTalking: "إنهاء الحديث",
  interrupt: "قاطع وتحدث",
  typeInstead: "اكتب",
  placeholder: "اكتب سؤالك…",
  send: "إرسال",
  mute: "كتم الصوت",
  unmute: "تشغيل الصوت",
  replay: "إعادة الاستماع",
  stopSpeaking: "إيقاف",
  close: "إغلاق",
  privacy: "لا يعمل الميكروفون إلا عند الضغط؛ لا يتم حفظ التسجيلات.",
  recording: "تسجيل",
  you: "أنت",
  micDenied: "لم يتم منح إذن الميكروفون. يمكنك المتابعة بالكتابة.",
  micUnsupported: "هذا المتصفح لا يدعم تسجيل الصوت. يمكنك المتابعة بالكتابة.",
  sttFailed: "لم أفهم ما قلته. حاول مرة أخرى أو اكتب.",
  aiFailed: "المساعد لا يستطيع الرد الآن. يمكنك متابعة استخدام القائمة.",
  rateLimited: "طلبات كثيرة في وقت قصير. يرجى الانتظار قليلًا.",
  tooLong: "الرسالة طويلة جدًا. يرجى الاختصار.",
  repeat: "هل يمكنك التكرار من فضلك؟",
  disabled: "المساعد غير متاح حاليًا.",
  addToCart: "أضف إلى السلة",
  cancel: "إلغاء",
  openProduct: "افتح الطبق",
  prepareCart: "جهّز السلة",
  openCart: "افتح السلة",
  update: "تحديث",
  remove: "إزالة من السلة",
  total: "المجموع",
  added: "تمت الإضافة إلى السلة.",
  updated: "تم تحديث السلة.",
  dismissed: "تم الإلغاء.",
  chooseOptions: "يلزم الاختيار",
  service: { WAITER: "استدعاء النادل", WATER: "طلب الماء", NAPKIN: "طلب المناديل", BILL: "طلب الحساب" },
  serviceSent: { WAITER: "تم إرسال استدعاء النادل.", WATER: "تم إرسال طلب الماء.", NAPKIN: "تم إرسال طلب المناديل.", BILL: "تم إرسال طلب الحساب." },
  serviceAlready: { WAITER: "لقد استدعيت النادل بالفعل.", WATER: "تم إرسال طلب الماء مسبقًا.", NAPKIN: "تم إرسال طلب المناديل مسبقًا.", BILL: "تم إرسال طلب الحساب مسبقًا." },
  menuInLanguage: (l) => `اعرض القائمة أيضًا بـ ${l}`,
};

const ru: AssistantStrings = {
  cta: AI_CTA.ru,
  title: "MasaNova AI",
  ready: "Чем могу помочь?",
  listening: "Слушаю...",
  thinking: "Думаю...",
  preparing: "Готовлю ответ...",
  speaking: "Говорю...",
  tapToTalk: "Говорите... — нажмите, чтобы начать",
  stopTalking: "Закончить",
  interrupt: "Перебить и сказать",
  typeInstead: "Написать",
  placeholder: "Введите вопрос…",
  send: "Отправить",
  mute: "Выключить звук",
  unmute: "Включить звук",
  replay: "Повторить ответ",
  stopSpeaking: "Стоп",
  close: "Закрыть",
  privacy: "Микрофон включается только по нажатию; записи не сохраняются.",
  recording: "Запись",
  you: "Вы",
  micDenied: "Доступ к микрофону не разрешён. Можно продолжить текстом.",
  micUnsupported: "Этот браузер не поддерживает запись голоса. Можно продолжить текстом.",
  sttFailed: "Повторите, пожалуйста. Не удалось разобрать речь — можно также написать.",
  aiFailed: "Ассистент сейчас не может ответить. Меню продолжает работать.",
  rateLimited: "Слишком много запросов. Пожалуйста, подождите немного.",
  tooLong: "Сообщение слишком длинное. Сформулируйте короче.",
  repeat: "Повторите, пожалуйста.",
  disabled: "Ассистент сейчас недоступен.",
  addToCart: "Добавить в корзину",
  cancel: "Отмена",
  openProduct: "Открыть блюдо",
  prepareCart: "Подготовить корзину",
  openCart: "Открыть корзину",
  update: "Обновить",
  remove: "Убрать из корзины",
  total: "Итого",
  added: "Добавлено в корзину.",
  updated: "Корзина обновлена.",
  dismissed: "Отменено.",
  chooseOptions: "Нужен выбор",
  service: { WAITER: "Позвать официанта", WATER: "Попросить воду", NAPKIN: "Попросить салфетки", BILL: "Попросить счёт" },
  serviceSent: { WAITER: "Официант вызван.", WATER: "Запрос на воду отправлен.", NAPKIN: "Запрос на салфетки отправлен.", BILL: "Запрос счёта отправлен." },
  serviceAlready: { WAITER: "Официант уже вызван.", WATER: "Запрос на воду уже отправлен.", NAPKIN: "Запрос на салфетки уже отправлен.", BILL: "Запрос счёта уже отправлен." },
  menuInLanguage: (l) => `Показать меню на языке: ${l}`,
};

const STRINGS: Record<AiLanguage, AssistantStrings> = { tr, en, de, ar, ru };

export function assistantStrings(language: AiLanguage): AssistantStrings {
  return STRINGS[language] ?? tr;
}

/** Canlı sesli konuşma (Sprint 10) metinleri. */
export type LiveStrings = {
  start: string;
  end: string;
  connecting: string;
  listening: string;
  understanding: string;
  responding: string;
  speaking: string;
  reconnecting: string;
  interrupt: string;
  micUnavailable: string;
  fallback: string;
  unavailable: string;
  ended: string;
  idleEnded: string;
  hint: string;
  liveBadge: string;
};

const LIVE: Record<AiLanguage, LiveStrings> = {
  tr: {
    start: "Sesli Konuşmayı Başlat",
    end: "Konuşmayı Bitir",
    connecting: "Bağlanıyor…",
    listening: "Dinliyorum",
    understanding: "Anlıyorum",
    responding: "Yanıtlıyor",
    speaking: "Konuşuyor",
    reconnecting: "Bağlantı yenileniyor…",
    interrupt: "Sözü Kes",
    micUnavailable: "Mikrofona erişilemedi. Yazarak devam edebilirsiniz.",
    fallback: "Sesli bağlantı kurulamadı. Bas-konuş moduna geçildi.",
    unavailable: "Asistan şu anda yanıt veremiyor.",
    ended: "Sesli konuşma bitti. İstediğiniz zaman yeniden başlatabilirsiniz.",
    idleEnded: "Bir süredir ses gelmediği için mikrofon kapatıldı.",
    hint: "Konuşmanız bitince kısa bir sessizlik yeterli. Asistan konuşurken söze girebilirsiniz.",
    liveBadge: "Canlı",
  },
  en: {
    start: "Start voice conversation",
    end: "End conversation",
    connecting: "Connecting…",
    listening: "Listening",
    understanding: "Understanding",
    responding: "Responding",
    speaking: "Speaking",
    reconnecting: "Reconnecting…",
    interrupt: "Interrupt",
    micUnavailable: "Couldn't access the microphone. You can continue by typing.",
    fallback: "Live voice couldn't connect. Switched to push-to-talk.",
    unavailable: "The assistant can't respond right now.",
    ended: "Voice conversation ended. You can start again anytime.",
    idleEnded: "The microphone was turned off after a period of silence.",
    hint: "A short pause ends your turn. You can interrupt while the assistant is speaking.",
    liveBadge: "Live",
  },
  de: {
    start: "Sprachgespräch starten",
    end: "Gespräch beenden",
    connecting: "Verbinde…",
    listening: "Ich höre zu",
    understanding: "Verstehe",
    responding: "Antwortet",
    speaking: "Spricht",
    reconnecting: "Verbindung wird erneuert…",
    interrupt: "Unterbrechen",
    micUnavailable: "Kein Zugriff auf das Mikrofon. Sie können per Text fortfahren.",
    fallback: "Live-Sprache nicht verfügbar. Auf Drücken-zum-Sprechen umgestellt.",
    unavailable: "Der Assistent kann gerade nicht antworten.",
    ended: "Sprachgespräch beendet. Sie können jederzeit neu starten.",
    idleEnded: "Das Mikrofon wurde nach längerer Stille ausgeschaltet.",
    hint: "Eine kurze Pause beendet Ihre Eingabe. Sie können den Assistenten unterbrechen.",
    liveBadge: "Live",
  },
  ar: {
    start: "ابدأ المحادثة الصوتية",
    end: "إنهاء المحادثة",
    connecting: "جارٍ الاتصال…",
    listening: "أستمع",
    understanding: "أفهم",
    responding: "يرد",
    speaking: "يتحدث",
    reconnecting: "جارٍ إعادة الاتصال…",
    interrupt: "مقاطعة",
    micUnavailable: "تعذّر الوصول إلى الميكروفون. يمكنك المتابعة بالكتابة.",
    fallback: "تعذّر الاتصال الصوتي المباشر. تم التحويل إلى الضغط للتحدث.",
    unavailable: "لا يستطيع المساعد الرد الآن.",
    ended: "انتهت المحادثة الصوتية. يمكنك البدء من جديد في أي وقت.",
    idleEnded: "تم إيقاف الميكروفون بعد فترة من الصمت.",
    hint: "توقف قصير ينهي كلامك. يمكنك مقاطعة المساعد أثناء حديثه.",
    liveBadge: "مباشر",
  },
  ru: {
    start: "Начать голосовой разговор",
    end: "Завершить разговор",
    connecting: "Подключение…",
    listening: "Слушаю",
    understanding: "Понимаю",
    responding: "Отвечает",
    speaking: "Говорит",
    reconnecting: "Переподключение…",
    interrupt: "Перебить",
    micUnavailable: "Нет доступа к микрофону. Можно продолжить текстом.",
    fallback: "Голосовая связь недоступна. Включён режим «нажми и говори».",
    unavailable: "Ассистент сейчас не может ответить.",
    ended: "Голосовой разговор завершён. Можно начать снова в любое время.",
    idleEnded: "Микрофон выключен после паузы.",
    hint: "Короткая пауза завершает вашу реплику. Ассистента можно перебить.",
    liveBadge: "Live",
  },
};

export function liveStrings(language: AiLanguage): LiveStrings {
  return LIVE[language] ?? LIVE.tr;
}
