import "server-only";
import type { AiCompletionRequest, AiProvider } from "@/lib/ai/provider";
import { parseBudgetAndGuests, parseNumberWord } from "@/lib/ai/recommendation";
import { looksLikeInjection, looksOutOfScope } from "@/lib/ai/safety";
import type { AiLanguage } from "@/lib/voice/language-detection";
import type { SttProvider, TtsProvider } from "@/lib/voice/provider";
import type { ToolResult } from "@/server/services/ai/tool-results";

/**
 * "mock" sağlayıcılar — YALNIZCA geliştirme ve otomatik test (ücretli API gerekmez). Kural tabanlı asistan, gerçek
 * sağlayıcıyla AYNI araç katmanını kullanır (yanıtlar yalnızca araç sonuçlarından); güvenlik testleri bu yüzden anlamlıdır.
 * STT: "MOCK-STT:<metin>" içeren ses gövdesini metne çevirir (tarayıcı testinde mikrofon taklidi). TTS: sessiz WAV.
 * Üretimde kullanmayın (.env.example).
 */
type Strings = {
  scope: string;
  refusal: string;
  fallback: string;
  howHelp: string;
  checkout: string;
  notFound: (q: string) => string;
  soldOut: (n: string) => string;
  available: (n: string, p: string) => string;
  ingredients: (n: string, list: string) => string;
  noIngredients: (n: string, d: string | null) => string;
  allergenUnknown: (n: string) => string;
  allergenList: (n: string, list: string) => string;
  allergenAbsent: (n: string, a: string) => string;
  allergenNone: (n: string) => string;
  spicyYes: (n: string) => string;
  spicyUnknown: (n: string) => string;
  list: (items: string) => string;
  dietaryNone: (tag: string) => string;
  cheapest: (n: string, p: string) => string;
  recommend: (items: string, total: string, budget: string | null) => string;
  recommendNone: string;
  dietFor: (tag: string, name: string) => string;
  dietUnmet: (tag: string) => string;
  unclear: string;
  addAsk: (q: number, n: string) => string;
  configure: (n: string, choice: string | null) => string;
  service: Record<"WAITER" | "WATER" | "NAPKIN" | "BILL", { ask: string; already: string }>;
  cartEmpty: string;
  cart: (items: string, total: string) => string;
  noOrders: string;
  orders: (items: string) => string;
  status: Record<string, string>;
  and: string;
};

const S: Record<AiLanguage, Strings> = {
  tr: {
    scope: "Bu restorandaki menü, sipariş ve servis konularında yardımcı olabilirim.",
    refusal: "Bunu paylaşamam. Menü, sipariş ya da servis konusunda yardımcı olabilirim.",
    fallback: "Menü, sepet ya da masa servisi konusunda yardımcı olabilirim. Örneğin bir ürünü sorabilir ya da öneri isteyebilirsiniz.",
    howHelp: "Size nasıl yardımcı olabilirim?",
    checkout: "Siparişi ben gönderemem. Sepetiniz hazır; son kontrol için Siparişi Onayla düğmesini kullanabilirsiniz.",
    notFound: (q) => `Menüde “${q}” bulamadım. İsterseniz benzer seçenekler önerebilirim.`,
    soldOut: (n) => `${n} şu anda tükenmiş görünüyor.`,
    available: (n, p) => `Evet, ${n} var. Fiyatı ${p}.`,
    ingredients: (n, l) => `Restoranın belirttiğine göre ${n} içinde ${l} var.`,
    noIngredients: (n, d) => (d ? `${n}: ${d}` : `${n} için içerik bilgisi belirtilmemiş.`),
    allergenUnknown: (n) => `${n} için yeterli alerjen bilgisi belirtilmemiş. Lütfen personele danışın.`,
    allergenList: (n, l) => `Restoranın belirttiği bilgilere göre ${n} şu alerjenleri içeriyor: ${l}. Çapraz bulaşma riski için personele danışmanızı öneririm.`,
    allergenAbsent: (n, a) => `Restoranın belirttiği bilgilere göre ${n} için ${a} listelenmemiş. Ancak çapraz bulaşma riski için personele danışmanızı öneririm.`,
    allergenNone: (n) => `Restoranın belirttiği bilgilere göre ${n} için alerjen listelenmemiş. Ancak çapraz bulaşma riski için personele danışmanızı öneririm.`,
    spicyYes: (n) => `${n}, restoran tarafından acılı olarak işaretlenmiş.`,
    spicyUnknown: (n) => `Restoran ${n} için acılık bilgisi belirtmemiş. Personele sorabilirsiniz.`,
    list: (i) => `Restoranın işaretlediği seçenekler: ${i}.`,
    dietaryNone: (t) => `Restoran ${t} olarak işaretlenmiş bir ürün belirtmemiş.`,
    cheapest: (n, p) => `En uygun fiyatlı seçenek ${n}, ${p}.`,
    recommend: (i, t, b) => `${b ? `${b} bütçeyle ` : ""}şunları önerebilirim: ${i}. Toplam ${t}.`,
    recommendNone: "Bu ölçütlere uyan bir seçenek bulamadım. Bütçeyi ya da tercihi değiştirmek ister misiniz?",
    dietFor: (tag, n) => `${tag} için: ${n}.`,
    dietUnmet: (tag) => `Restoran ${tag} olarak işaretlenmiş bir ana yemek belirtmemiş.`,
    unclear: "Sizi tam anlayamadım. Tekrar eder misiniz?",
    addAsk: (q, n) => `${q} ${n} ürününü sepete eklememi ister misiniz?`,
    configure: (n, c) => (c ? `${n} için ${c} seçmeniz gerekiyor. Ürünü açıyorum, seçiminizi yapabilirsiniz.` : `${n} için bir seçenek seçmeniz gerekiyor. Ürünü açabilirsiniz.`),
    service: {
      WAITER: { ask: "Garson çağırmak ister misiniz?", already: "Garson çağrınız zaten personele iletilmiş." },
      WATER: { ask: "Su talebi göndermemi ister misiniz?", already: "Su talebiniz zaten personele iletilmiş." },
      NAPKIN: { ask: "Peçete talebi göndermemi ister misiniz?", already: "Peçete talebiniz zaten personele iletilmiş." },
      BILL: { ask: "Hesap istemek ister misiniz?", already: "Hesap talebiniz zaten personele iletilmiş." },
    },
    cartEmpty: "Sepetiniz şu anda boş.",
    cart: (i, t) => `Sepetinizde ${i} var. Güncel toplam ${t}.`,
    noOrders: "Bu cihazdan verilmiş güncel bir sipariş görünmüyor.",
    orders: (i) => `Sipariş durumu: ${i}.`,
    status: { SUBMITTED: "onay bekliyor", ACCEPTED: "kabul edildi", PREPARING: "hazırlanıyor", READY: "hazır", SERVED: "servis edildi", CANCELLED: "iptal edildi", REJECTED: "kabul edilemedi" },
    and: "ve",
  },
  en: {
    scope: "I can help with this restaurant's menu, orders and table service.",
    refusal: "I can't share that. I'm happy to help with the menu, your order or table service.",
    fallback: "I can help with the menu, your cart or table service. For example, ask about a dish or for a recommendation.",
    howHelp: "How can I help you?",
    checkout: "I can't send the order myself. Your cart is ready; please use the Confirm Order button for the final check.",
    notFound: (q) => `I couldn't find “${q}” on the menu. I can suggest something similar if you like.`,
    soldOut: (n) => `${n} appears to be sold out right now.`,
    available: (n, p) => `Yes, we have ${n}. It costs ${p}.`,
    ingredients: (n, l) => `According to the restaurant, ${n} contains ${l}.`,
    noIngredients: (n, d) => (d ? `${n}: ${d}` : `No ingredient information is provided for ${n}.`),
    allergenUnknown: (n) => `Not enough allergen information has been provided for ${n}. Please ask the staff.`,
    allergenList: (n, l) => `According to the restaurant, ${n} contains: ${l}. Please check with the staff about cross-contamination.`,
    allergenAbsent: (n, a) => `According to the restaurant's information, ${a} is not listed for ${n}. Please still check with the staff about cross-contamination.`,
    allergenNone: (n) => `According to the restaurant's information, no allergens are listed for ${n}. Please still check with the staff about cross-contamination.`,
    spicyYes: (n) => `${n} is marked as spicy by the restaurant.`,
    spicyUnknown: (n) => `The restaurant hasn't specified the spice level of ${n}. You can ask the staff.`,
    list: (i) => `Options marked by the restaurant: ${i}.`,
    dietaryNone: (t) => `The restaurant hasn't marked any dishes as ${t}.`,
    cheapest: (n, p) => `The most affordable option is ${n} at ${p}.`,
    recommend: (i, t, b) => `${b ? `Within ${b}, ` : ""}I can suggest ${i}. Total ${t}.`,
    recommendNone: "I couldn't find anything matching that. Would you like to change the budget or preference?",
    dietFor: (tag, n) => `For ${tag}: ${n}.`,
    dietUnmet: (tag) => `The restaurant hasn't marked any main dish as ${tag}.`,
    unclear: "Sorry, I didn't quite catch that. Could you say it again?",
    addAsk: (q, n) => `Shall I add ${q} × ${n} to your cart?`,
    configure: (n, c) => (c ? `For ${n} you need to choose the ${c}. I'll open the dish so you can choose.` : `${n} needs a choice. You can open the dish to choose.`),
    service: {
      WAITER: { ask: "Would you like me to call a waiter?", already: "Your waiter call has already been sent to the staff." },
      WATER: { ask: "Shall I send a water request?", already: "Your water request has already been sent to the staff." },
      NAPKIN: { ask: "Shall I request napkins?", already: "Your napkin request has already been sent to the staff." },
      BILL: { ask: "Would you like to request the bill?", already: "Your bill request has already been sent to the staff." },
    },
    cartEmpty: "Your cart is empty at the moment.",
    cart: (i, t) => `Your cart has ${i}. Current total ${t}.`,
    noOrders: "I don't see a recent order from this device.",
    orders: (i) => `Order status: ${i}.`,
    status: { SUBMITTED: "waiting for confirmation", ACCEPTED: "accepted", PREPARING: "being prepared", READY: "ready", SERVED: "served", CANCELLED: "cancelled", REJECTED: "not accepted" },
    and: "and",
  },
  de: {
    scope: "Ich helfe gern bei Speisekarte, Bestellung und Tischservice dieses Restaurants.",
    refusal: "Das kann ich nicht teilen. Gern helfe ich bei Speisekarte, Bestellung oder Service.",
    fallback: "Ich helfe bei Speisekarte, Warenkorb oder Tischservice. Fragen Sie z. B. nach einem Gericht oder einer Empfehlung.",
    howHelp: "Wie kann ich Ihnen helfen?",
    checkout: "Ich kann die Bestellung nicht selbst senden. Ihr Warenkorb ist bereit; bitte nutzen Sie zur Kontrolle die Schaltfläche „Bestellung bestätigen“.",
    notFound: (q) => `„${q}“ steht nicht auf der Karte. Ich kann Ihnen gern etwas Ähnliches empfehlen.`,
    soldOut: (n) => `${n} scheint gerade ausverkauft zu sein.`,
    available: (n, p) => `Ja, ${n} gibt es. Preis: ${p}.`,
    ingredients: (n, l) => `Laut Restaurant enthält ${n}: ${l}.`,
    noIngredients: (n, d) => (d ? `${n}: ${d}` : `Für ${n} sind keine Zutaten angegeben.`),
    allergenUnknown: (n) => `Für ${n} sind nicht genügend Allergenangaben vorhanden. Bitte fragen Sie das Personal.`,
    allergenList: (n, l) => `Laut Restaurant enthält ${n}: ${l}. Bitte fragen Sie das Personal wegen Kreuzkontamination.`,
    allergenAbsent: (n, a) => `Laut Angaben des Restaurants ist ${a} für ${n} nicht aufgeführt. Bitte fragen Sie trotzdem wegen Kreuzkontamination nach.`,
    allergenNone: (n) => `Laut Angaben des Restaurants sind für ${n} keine Allergene aufgeführt. Bitte fragen Sie trotzdem wegen Kreuzkontamination nach.`,
    spicyYes: (n) => `${n} ist vom Restaurant als scharf markiert.`,
    spicyUnknown: (n) => `Das Restaurant hat für ${n} keine Schärfe angegeben. Fragen Sie gern das Personal.`,
    list: (i) => `Vom Restaurant markierte Optionen: ${i}.`,
    dietaryNone: (t) => `Das Restaurant hat keine Gerichte als ${t} markiert.`,
    cheapest: (n, p) => `Die günstigste Option ist ${n} für ${p}.`,
    recommend: (i, t, b) => `${b ? `Mit ${b} ` : ""}kann ich empfehlen: ${i}. Gesamt ${t}.`,
    recommendNone: "Dazu habe ich nichts Passendes gefunden. Möchten Sie Budget oder Vorlieben ändern?",
    dietFor: (tag, n) => `Für ${tag}: ${n}.`,
    dietUnmet: (tag) => `Das Restaurant hat kein Hauptgericht als ${tag} markiert.`,
    unclear: "Entschuldigung, das habe ich nicht verstanden. Könnten Sie es wiederholen?",
    addAsk: (q, n) => `Soll ich ${q} × ${n} in den Warenkorb legen?`,
    configure: (n, c) => (c ? `Für ${n} müssen Sie ${c} wählen. Ich öffne das Gericht für Ihre Auswahl.` : `${n} erfordert eine Auswahl. Sie können das Gericht öffnen.`),
    service: {
      WAITER: { ask: "Möchten Sie einen Kellner rufen?", already: "Ihr Kellnerruf wurde bereits gesendet." },
      WATER: { ask: "Soll ich Wasser anfordern?", already: "Ihre Wasser-Anfrage wurde bereits gesendet." },
      NAPKIN: { ask: "Soll ich Servietten anfordern?", already: "Ihre Servietten-Anfrage wurde bereits gesendet." },
      BILL: { ask: "Möchten Sie die Rechnung anfordern?", already: "Ihre Rechnungsanfrage wurde bereits gesendet." },
    },
    cartEmpty: "Ihr Warenkorb ist leer.",
    cart: (i, t) => `Im Warenkorb: ${i}. Aktueller Gesamtbetrag ${t}.`,
    noOrders: "Ich sehe keine aktuelle Bestellung von diesem Gerät.",
    orders: (i) => `Bestellstatus: ${i}.`,
    status: { SUBMITTED: "wartet auf Bestätigung", ACCEPTED: "angenommen", PREPARING: "in Zubereitung", READY: "fertig", SERVED: "serviert", CANCELLED: "storniert", REJECTED: "nicht angenommen" },
    and: "und",
  },
  ar: {
    scope: "يمكنني المساعدة في قائمة هذا المطعم والطلبات وخدمة الطاولة.",
    refusal: "لا يمكنني مشاركة ذلك. يسعدني مساعدتك في القائمة أو الطلب أو الخدمة.",
    fallback: "يمكنني المساعدة في القائمة أو السلة أو خدمة الطاولة. اسأل مثلًا عن طبق أو اطلب اقتراحًا.",
    howHelp: "كيف يمكنني مساعدتك؟",
    checkout: "لا يمكنني إرسال الطلب بنفسي. سلتك جاهزة؛ يرجى استخدام زر تأكيد الطلب للمراجعة النهائية.",
    notFound: (q) => `لم أجد «${q}» في القائمة. يمكنني اقتراح شيء مشابه إذا أردت.`,
    soldOut: (n) => `يبدو أن ${n} نفد حاليًا.`,
    available: (n, p) => `نعم، ${n} متوفر. السعر ${p}.`,
    ingredients: (n, l) => `حسب المطعم، يحتوي ${n} على: ${l}.`,
    noIngredients: (n, d) => (d ? `${n}: ${d}` : `لا توجد معلومات مكونات لـ ${n}.`),
    allergenUnknown: (n) => `لم يقدّم المطعم معلومات كافية عن مسببات الحساسية في ${n}. يرجى سؤال الموظفين.`,
    allergenList: (n, l) => `حسب معلومات المطعم، يحتوي ${n} على: ${l}. يرجى سؤال الموظفين عن خطر التلوث المتبادل.`,
    allergenAbsent: (n, a) => `حسب معلومات المطعم، ${a} غير مدرج في ${n}. ومع ذلك يرجى سؤال الموظفين عن التلوث المتبادل.`,
    allergenNone: (n) => `حسب معلومات المطعم، لا توجد مسببات حساسية مدرجة في ${n}. ومع ذلك يرجى سؤال الموظفين عن التلوث المتبادل.`,
    spicyYes: (n) => `${n} مصنف كحار من قبل المطعم.`,
    spicyUnknown: (n) => `لم يحدد المطعم درجة الحرارة لـ ${n}. يمكنك سؤال الموظفين.`,
    list: (i) => `الخيارات التي حددها المطعم: ${i}.`,
    dietaryNone: (t) => `لم يحدد المطعم أي طبق على أنه ${t}.`,
    cheapest: (n, p) => `الخيار الأوفر هو ${n} بسعر ${p}.`,
    recommend: (i, t, b) => `${b ? `ضمن ميزانية ${b} ` : ""}أقترح: ${i}. المجموع ${t}.`,
    recommendNone: "لم أجد خيارًا مناسبًا. هل تريد تغيير الميزانية أو التفضيل؟",
    dietFor: (tag, n) => `لـ ${tag}: ${n}.`,
    dietUnmet: (tag) => `لم يحدد المطعم أي طبق رئيسي على أنه ${tag}.`,
    unclear: "عذرًا، لم أفهم جيدًا. هل يمكنك التكرار؟",
    addAsk: (q, n) => `هل أضيف ${q} × ${n} إلى السلة؟`,
    configure: (n, c) => (c ? `يجب اختيار ${c} لـ ${n}. سأفتح الطبق لتختار.` : `يتطلب ${n} اختيارًا. يمكنك فتح الطبق.`),
    service: {
      WAITER: { ask: "هل تريد استدعاء النادل؟", already: "تم إرسال استدعاء النادل مسبقًا." },
      WATER: { ask: "هل أرسل طلب الماء؟", already: "تم إرسال طلب الماء مسبقًا." },
      NAPKIN: { ask: "هل أطلب المناديل؟", already: "تم إرسال طلب المناديل مسبقًا." },
      BILL: { ask: "هل تريد طلب الحساب؟", already: "تم إرسال طلب الحساب مسبقًا." },
    },
    cartEmpty: "سلتك فارغة حاليًا.",
    cart: (i, t) => `في سلتك: ${i}. المجموع الحالي ${t}.`,
    noOrders: "لا أرى طلبًا حديثًا من هذا الجهاز.",
    orders: (i) => `حالة الطلب: ${i}.`,
    status: { SUBMITTED: "بانتظار التأكيد", ACCEPTED: "مقبول", PREPARING: "قيد التحضير", READY: "جاهز", SERVED: "تم التقديم", CANCELLED: "ملغى", REJECTED: "لم يُقبل" },
    and: "و",
  },
  ru: {
    scope: "Я помогу с меню этого ресторана, заказом и обслуживанием столика.",
    refusal: "Этим я поделиться не могу. С радостью помогу с меню, заказом или обслуживанием.",
    fallback: "Я помогу с меню, корзиной или обслуживанием. Например, спросите о блюде или попросите совет.",
    howHelp: "Чем могу помочь?",
    checkout: "Я не могу сам отправить заказ. Корзина готова; для финальной проверки нажмите «Подтвердить заказ».",
    notFound: (q) => `В меню нет «${q}». Могу предложить что-то похожее.`,
    soldOut: (n) => `${n}, похоже, сейчас закончился.`,
    available: (n, p) => `Да, ${n} есть. Цена ${p}.`,
    ingredients: (n, l) => `По данным ресторана, в ${n}: ${l}.`,
    noIngredients: (n, d) => (d ? `${n}: ${d}` : `Для ${n} состав не указан.`),
    allergenUnknown: (n) => `Для ${n} недостаточно информации об аллергенах. Пожалуйста, уточните у персонала.`,
    allergenList: (n, l) => `По данным ресторана, ${n} содержит: ${l}. Уточните у персонала риск перекрёстного загрязнения.`,
    allergenAbsent: (n, a) => `По данным ресторана, ${a} для ${n} не указан. Но всё же уточните у персонала риск перекрёстного загрязнения.`,
    allergenNone: (n) => `По данным ресторана, аллергены для ${n} не указаны. Но всё же уточните у персонала риск перекрёстного загрязнения.`,
    spicyYes: (n) => `${n} отмечено рестораном как острое.`,
    spicyUnknown: (n) => `Ресторан не указал остроту для ${n}. Можно уточнить у персонала.`,
    list: (i) => `Отмеченные рестораном варианты: ${i}.`,
    dietaryNone: (t) => `Ресторан не отметил блюда как «${t}».`,
    cheapest: (n, p) => `Самый доступный вариант — ${n}, ${p}.`,
    recommend: (i, t, b) => `${b ? `В пределах ${b} ` : ""}могу предложить: ${i}. Итого ${t}.`,
    recommendNone: "Подходящих вариантов не нашлось. Изменить бюджет или предпочтения?",
    dietFor: (tag, n) => `Для ${tag}: ${n}.`,
    dietUnmet: (tag) => `Ресторан не отметил основные блюда как ${tag}.`,
    unclear: "Извините, не расслышал. Повторите, пожалуйста.",
    addAsk: (q, n) => `Добавить ${q} × ${n} в корзину?`,
    configure: (n, c) => (c ? `Для ${n} нужно выбрать: ${c}. Открою блюдо, чтобы вы выбрали.` : `Для ${n} нужен выбор. Откройте блюдо.`),
    service: {
      WAITER: { ask: "Позвать официанта?", already: "Официант уже вызван." },
      WATER: { ask: "Попросить воду?", already: "Запрос на воду уже отправлен." },
      NAPKIN: { ask: "Попросить салфетки?", already: "Запрос на салфетки уже отправлен." },
      BILL: { ask: "Попросить счёт?", already: "Запрос счёта уже отправлен." },
    },
    cartEmpty: "Корзина пока пуста.",
    cart: (i, t) => `В корзине: ${i}. Текущая сумма ${t}.`,
    noOrders: "Недавних заказов с этого устройства не видно.",
    orders: (i) => `Статус заказа: ${i}.`,
    status: { SUBMITTED: "ожидает подтверждения", ACCEPTED: "принят", PREPARING: "готовится", READY: "готов", SERVED: "подан", CANCELLED: "отменён", REJECTED: "не принят" },
    and: "и",
  },
};

// ─── Niyet kalıpları (5 dil) ───
const R = {
  checkout: /(sipari[sş]i? (g[oö]nder|ver|tamamla|onayla)|place (the |my )?order|submit (the |my )?order|send (the |my )?order|confirm (the |my )?order|bestellung (abschicken|aufgeben|senden)|bestellen sie|отправ\S* заказ|оформ\S* заказ|أرسل الطلب|اطلب الآن)/i,
  waiter: /(garson|waiter|kellner|bedienung|официант|نادل|الجرسون|النادل)/i,
  water: /((^|\s)su(\s|$|yu|ya)|water|wasser|вод[уаы]|ماء|مياه)/i,
  napkin: /(pe[cç]ete|napkin|serviette|салфет|مناديل|منديل)/i,
  bill: /(hesab|hesap|the bill|bill please|check please|rechnung|сч[её]т|الحساب|الفاتورة)/i,
  cart: /(sepet|cart|warenkorb|корзин|السلة)/i,
  add: /(ekle|ekleyelim|ekler misin|add|hinzuf[uü]g|dazu|добав|положи|أضف|اضف)/i,
  orderStatus: /(sipari[sş]im|order status|where is my order|my order|meine bestellung|мой заказ|заказ готов|طلبي)/i,
  allergen: /(alerj|allerg|аллерг|حساسية|f[iı]st[iı]k|peanut|nuss|nüsse|орех|فول سوداني|gluten|глютен|غلوتين|laktoz|lactose|süt|milk|milch|молок|حليب|yumurta|egg|ei\b|яйц|بيض|susam|sesame|sesam|кунжут|سمسم)/i,
  ingredients: /(i[cç]inde ne var|\S+(?:[ıiuü]nda|[ıiuü]nde|nda|nde) ne var|i[cç]eri[gğ]i|neler var i[cç]inde|ne i[cç]eriyor|what'?s in|ingredients|what is in|was ist (da )?drin|zutaten|что в|состав|из чего|ماذا يحتوي|مكونات)/i,
  spicy: /(ac[iı] m[iı]|ac[iı]l[iı]|spicy|scharf|остр|حار)/i,
  vegan: /(vegan|веган|نباتي صرف)/i,
  vegetarian: /(vejetaryen|vegetarian|vegetarisch|вегетариан|نباتي)/i,
  glutenFree: /(glutensiz|gluten[- ]?free|glutenfrei|без глютена|خالي من الغلوتين)/i,
  halal: /(helal|halal|халяль|حلال)/i,
  cheapest: /(en ucuz|en uygun fiyat|cheapest|least expensive|g[uü]nstigst|самый дешев|самое дешев|أرخص)/i,
  dessert: /(tatl[iı]|dessert|nachtisch|десерт|حلوى|حلويات)/i,
  recommend: /([oö]ner|tavsiye|recommend|suggest|empfehl|посовет|порекоменд|предлож|اقترح|انصح|تنصح)/i,
  light: /(hafif|a[gğ][iı]r olmayan|light|leicht|л[её]гк|خفيف)/i,
  exists: /(var m[iı]|bulunur mu|do you have|is there|have you got|gibt es|habt ihr|haben sie|есть ли|у вас есть|هل يوجد|هل لديكم)/i,
};

const FILLER =
  /\b(var|mı|mi|mu|mü|do|you|have|any|is|there|gibt|es|habt|ihr|haben|sie|есть|ли|у|вас|هل|يوجد|لديكم|lütfen|please|bitte|пожалуйста|menüde|menu|on|the|a|an|ein|eine|en|bir|bana|me|uns|nam|мне|ne|what|was)\b/giu;

function keyword(utterance: string): string {
  return utterance.replace(/[?!.,؟]/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim().slice(0, 40) || utterance.slice(0, 40);
}

function quantityFrom(utterance: string): number {
  for (const token of utterance.toLocaleLowerCase("tr-TR").split(/[\s,]+/)) {
    const n = parseNumberWord(token.replace(/[^\p{L}\p{N}]/gu, ""));
    if (n && n <= 20) return n;
  }
  return 1;
}

function joinNames(items: string[], and: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

/** Kural tabanlı asistan — araçları sunucunun yürütücüsüyle çağırır; yanıtlar yalnızca araç sonuçlarından. */
export function createRuleBasedProvider(): AiProvider {
  const provider: AiProvider = {
    name: "mock",
    model: "rule-based-v1",
    async stream(req: AiCompletionRequest, onTextDelta: (delta: string) => void) {
      const result = await provider.complete(req);
      const words = result.text.split(/(?<=\s)/);
      for (const w of words) {
        if (req.signal?.aborted) throw new Error("aborted");
        onTextDelta(w);
        await new Promise((r) => setTimeout(r, 12));
      }
      return result;
    },
    async complete(req: AiCompletionRequest) {
      const t = S[req.language];
      const u = req.utterance;
      let calls = 0;
      const run = async <T extends ToolResult>(name: Parameters<AiCompletionRequest["executeTool"]>[0], args: unknown): Promise<T> => {
        calls += 1;
        return (await req.executeTool(name, args)) as T;
      };
      const done = (text: string) => ({ text, inputTokens: Math.ceil((req.system.length + u.length) / 4), outputTokens: Math.ceil(text.length / 4), toolCalls: calls });
      const has = (name: string) => req.tools.some((x) => x.name === name);

      if (looksLikeInjection(u)) return done(t.refusal);
      if (looksOutOfScope(u)) return done(t.scope);

      if (R.checkout.test(u) && has("openCartReview")) {
        await run("openCartReview", {});
        return done(t.checkout);
      }

      const serviceType = R.waiter.test(u) ? "WAITER" : R.bill.test(u) && !R.cart.test(u) ? "BILL" : R.napkin.test(u) ? "NAPKIN" : R.water.test(u) && !R.allergen.test(u) ? "WATER" : null;
      if (serviceType && has("prepareServiceRequest")) {
        const r = await run<Extract<ToolResult, { tool: "prepareServiceRequest" }>>("prepareServiceRequest", { type: serviceType });
        if (r.ok) return done(r.alreadyActive ? t.service[serviceType].already : t.service[serviceType].ask);
      }

      if (R.orderStatus.test(u)) {
        const r = await run<Extract<ToolResult, { tool: "getOrderStatus" }>>("getOrderStatus", {});
        return done(r.ok && r.orders.length ? t.orders(r.orders.map((o) => `${o.number} ${t.status[o.status] ?? o.status}`).join(", ")) : t.noOrders);
      }

      if (R.add.test(u) && has("prepareCartAddition")) {
        const r = await run<Extract<ToolResult, { tool: "prepareCartAddition" }>>("prepareCartAddition", { product: u, quantity: quantityFrom(u), variant: u });
        if (!r.ok) return done(r.reason === "sold_out" && r.name ? t.soldOut(r.name) : t.notFound(keyword(u.replace(R.add, ""))));
        return done(r.action === "configure" ? t.configure(r.name, r.requiredChoice) : t.addAsk(r.quantity, r.name));
      }

      if (R.cart.test(u)) {
        const r = await run<Extract<ToolResult, { tool: "getCartSummary" }>>("getCartSummary", {});
        return done(r.ok && r.lines.length ? t.cart(joinNames(r.lines.map((l) => `${l.quantity} ${l.name}`), t.and), r.totalLabel) : t.cartEmpty);
      }

      const { budgetMinor, guests } = parseBudgetAndGuests(u);
      if ((budgetMinor || guests || req.hints?.constraintFollowUp) && has("getRecommendationCandidates")) {
        const r = await run<Extract<ToolResult, { tool: "getRecommendationCandidates" }>>("getRecommendationCandidates", {
          ...(budgetMinor ? { budgetMinor } : {}),
          ...(guests ? { guests } : {}),
          kind: R.dessert.test(u) ? "dessert" : R.light.test(u) ? "light" : "meal",
        });
        if (!r.ok || r.empty) return done([t.recommendNone, ...(r.ok ? r.unmetDiets.map(t.dietUnmet) : [])].join(" "));
        const parts = [t.recommend(joinNames(r.items.map((i) => (i.quantity > 1 ? `${i.quantity} ${i.name}` : i.name)), t.and), r.totalLabel, r.budgetLabel)];
        for (const d of r.dietPicks) parts.push(t.dietFor(d.tag, d.name));
        for (const tag of r.unmetDiets) parts.push(t.dietUnmet(tag));
        return done(parts.join(" "));
      }

      const dietary = R.vegan.test(u) ? "vegan" : R.glutenFree.test(u) ? "gluten_free" : R.vegetarian.test(u) ? "vegetarian" : R.halal.test(u) ? "halal" : null;
      if (dietary) {
        const r = await run<Extract<ToolResult, { tool: "searchMenu" }>>("searchMenu", { dietaryTag: dietary, limit: 6 });
        const label = (u.match(R.vegan) ?? u.match(R.glutenFree) ?? u.match(R.vegetarian) ?? u.match(R.halal))?.[0] ?? dietary;
        return done(r.ok && r.items.length ? t.list(joinNames(r.items.map((i) => i.name), t.and)) : t.dietaryNone(label));
      }

      // Ürüne özgü sorular: önce ürünü bul.
      const productQuestion = R.ingredients.test(u) || R.allergen.test(u) || R.spicy.test(u);
      if (productQuestion) {
        const d = await run<Extract<ToolResult, { tool: "getProductDetails" }>>("getProductDetails", { product: u });
        if (!d.ok) return done(t.notFound(keyword(u)));
        const p = d.product;
        if (R.allergen.test(u)) {
          if (!p.allergenInfoDeclared) return done(t.allergenUnknown(p.name));
          const asked = u.match(R.allergen)?.[0] ?? "";
          const listed = p.allergens.find((a) => a.toLocaleLowerCase("tr-TR").includes(asked.toLocaleLowerCase("tr-TR").slice(0, 4)));
          if (/alerj|allerg|аллерг|حساسية/i.test(asked)) return done(p.allergens.length ? t.allergenList(p.name, p.allergens.join(", ")) : t.allergenNone(p.name));
          return done(listed ? t.allergenList(p.name, p.allergens.join(", ")) : t.allergenAbsent(p.name, asked));
        }
        if (R.spicy.test(u)) return done(p.spicy ? t.spicyYes(p.name) : t.spicyUnknown(p.name));
        return done(p.ingredients.length ? t.ingredients(p.name, p.ingredients.join(", ")) : t.noIngredients(p.name, p.description));
      }

      if (R.cheapest.test(u)) {
        const r = await run<Extract<ToolResult, { tool: "searchMenu" }>>("searchMenu", { query: keyword(u.replace(R.cheapest, "")), sort: "price_asc", limit: 1 });
        const first = r.ok ? r.items[0] : undefined;
        return done(first ? t.cheapest(first.name, first.priceLabel) : t.notFound(keyword(u.replace(R.cheapest, ""))));
      }

      if ((R.recommend.test(u) || R.dessert.test(u)) && has("getRecommendationCandidates")) {
        const query = keyword(u.replace(R.recommend, "").replace(R.dessert, "").replace(R.light, ""));
        const kind = R.dessert.test(u) ? "dessert" : R.light.test(u) ? "light" : "meal";
        let r = await run<Extract<ToolResult, { tool: "getRecommendationCandidates" }>>("getRecommendationCandidates", { kind, ...(query.length >= 3 && kind === "meal" ? { query } : {}) });
        if ((!r.ok || r.empty) && query.length >= 3) r = await run("getRecommendationCandidates", { kind });
        if (!r.ok || r.empty) return done(t.recommendNone);
        return done(t.recommend(joinNames(r.items.map((i) => (i.quantity > 1 ? `${i.quantity} ${i.name}` : i.name)), t.and), r.totalLabel, null));
      }

      // Ürün var mı / genel arama
      const direct = await run<Extract<ToolResult, { tool: "getProductAvailability" }>>("getProductAvailability", { product: u });
      if (direct.ok) return done(direct.soldOut ? t.soldOut(direct.name) : t.available(direct.name, direct.priceLabel));
      if (R.exists.test(u) || keyword(u).split(" ").length <= 3) {
        const q = keyword(u);
        const r = await run<Extract<ToolResult, { tool: "searchMenu" }>>("searchMenu", { query: q, limit: 4 });
        if (r.ok && r.items.length) return done(t.list(joinNames(r.items.map((i) => i.name), t.and)));
        if (q.length >= 2 && R.exists.test(u)) return done(t.notFound(q));
      }
      return done(t.fallback);
    },
  };
  return provider;
}

/** Mock STT: gövde "MOCK-STT:<metin>" ise metni döner; değilse anlaşılamadı (boş). Ham ses saklanmaz. */
export function createMockStt(): SttProvider {
  return {
    name: "mock",
    model: "mock-stt",
    async transcribe({ audio }) {
      const text = new TextDecoder().decode(audio);
      const match = text.match(/MOCK-STT(-LOW)?:([\s\S]{1,600})/);
      const transcript = match ? match[2]!.trim() : "";
      return { text: transcript, durationMs: transcript ? Math.min(45_000, 600 + transcript.length * 60) : 400, confidence: match?.[1] ? 0.2 : transcript ? 0.95 : null };
    },
  };
}

/** Mock TTS: metin uzunluğuna göre süreli sessiz WAV (8 kHz, 8 bit mono) — oynatma / durdurma testleri için. */
export function createMockTts(): TtsProvider {
  return {
    name: "mock",
    model: "mock-tts",
    async synthesize({ text }) {
      const seconds = Math.min(8, Math.max(1.5, text.length * 0.05));
      const rate = 8000;
      const samples = Math.round(seconds * rate);
      const buffer = new ArrayBuffer(44 + samples);
      const v = new DataView(buffer);
      const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      str(0, "RIFF");
      v.setUint32(4, 36 + samples, true);
      str(8, "WAVE");
      str(12, "fmt ");
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, rate, true);
      v.setUint32(28, rate, true);
      v.setUint16(32, 1, true);
      v.setUint16(34, 8, true);
      str(36, "data");
      v.setUint32(40, samples, true);
      new Uint8Array(buffer, 44).fill(128);
      return { audio: new Uint8Array(buffer), mimeType: "audio/wav" };
    },
  };
}
