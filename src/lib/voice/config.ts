import { AI_LIMITS } from "@/lib/ai/limits";

/**
 * Sesli asistan — MERKEZİ yapılandırma (bileşenlerde sabit değer yok). Değerler restoran gürültüsüne göre seçildi:
 * konuşmayı erken kesmemek (müzik, tabak, kahve makinesi) için sessizlik süresi uzun, eşik gürültü tabanına göre uyarlanır.
 */
export const VAD_CONFIG = {
  /** Kare uzunluğu (ms) — analiz aralığı. */
  frameMs: 20,
  /** Konuşma sayılması için RMS'in gürültü tabanını aşması gereken oran (×) ve mutlak alt sınır. */
  speechRatio: 3,
  minSpeechRms: 0.012,
  /** Gürültü tabanı uyarlama hızı (yalnızca sessiz karelerde; EMA). */
  noiseAdapt: 0.05,
  /** Konuşma başlangıcı için kesintisiz konuşma süresi (ms) — kısa tıkırtılar sayılmaz. */
  minSpeechMs: 220,
  /** İfade sonu: konuşmadan sonra bu kadar sessizlik (ms). */
  silenceMs: 900,
  /** Tek ifade üst sınırı (ms). */
  maxUtteranceMs: 30_000,
  /** Kayda dahil edilen konuşma öncesi tampon (ms) — ilk hece kaybolmasın. */
  preRollMs: 300,
  /** Asistan konuşurken araya girme: daha yüksek eşik (yankı / hoparlör sızıntısına karşı) ve daha uzun süre. */
  bargeInRatio: 5,
  bargeInMs: 320,
} as const;

export const SESSION_LIMITS = {
  /** Etkileşim yoksa mikrofon / canlı oturum kapanır (konuşma sonra sürdürülebilir). */
  idleTimeoutMs: AI_LIMITS.idleSessionMs,
  /** Canlı oturumun en uzun süresi. */
  maxSessionMs: AI_LIMITS.maxLiveSessionMs,
  /** Art arda bu kadar bağlantı / sağlayıcı hatasında bas-konuş moduna geçilir. */
  maxConsecutiveFailures: 2,
  /** Yeniden bağlanma: ilk bekleme (ms), üstel artış, en fazla bekleme ve deneme sayısı (~20 sn — sunucu yeniden başlatması). */
  reconnectDelayMs: 600,
  reconnectMaxDelayMs: 5_000,
  reconnectAttempts: 6,
  /** Aynı tur başka istekte işleniyorsa yeniden deneme aralığı ve toplam bekleme bütçesi (yarıda kalan tur ≤ 15 sn'de serbest kalır). */
  inProgressRetryMs: 1_000,
  inProgressBudgetMs: 25_000,
} as const;

/** Konuşmaya dönüştürme güveni: altındaysa tahmin yok, tekrar istenir. */
/** n. yeniden bağlanma denemesinden önceki bekleme. */
export function reconnectBackoff(attempt: number): number {
  return Math.min(SESSION_LIMITS.reconnectMaxDelayMs, SESSION_LIMITS.reconnectDelayMs * 2 ** Math.max(0, attempt));
}

export const TRANSCRIPT_CONFIDENCE_MIN = 0.55;

/** Kayıt örnekleme hızı (STT için yeterli, boyut küçük). */
export const CAPTURE_SAMPLE_RATE = 16_000;
