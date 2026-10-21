/**
 * AI / ses ALTYAPI güvenlik sınırları — tek yerde (maliyet koruması + takılmayan istekler). Bunlar platform sabitleridir:
 * işletme ayarları (AiSettings) ya da müşteri girdisi bunları DEĞİŞTİREMEZ; ayar formunda karşılığı yoktur.
 *
 * Zaman aşımı dolduğunda yukarı akış (sağlayıcı) isteği AbortSignal ile İPTAL edilir — arka planda yetim istek kalmaz.
 */
export const AI_LIMITS = {
  timeouts: {
    /** Konuşma → metin. */
    sttMs: 20_000,
    /** Sohbet tamamlama (araç turu başına tek istek). */
    chatMs: 20_000,
    /** Metin → konuşma (cümle başına). */
    ttsMs: 20_000,
    /** Canlı turun tamamı (STT + yanıt + tüm cümlelerin sesi). */
    liveTurnMs: 60_000,
  },
  /** Tek ifadenin en uzun süresi (sn) ve boyutu. */
  maxAudioSeconds: 45,
  maxAudioBytes: 3 * 1024 * 1024,
  /** Konuşma başına en fazla kullanıcı turu. */
  maxUserTurns: 60,
  /** Model yanıtı üst sınırı (token). */
  maxResponseTokens: 350,
  /** Tek seslendirme isteğindeki en fazla karakter. */
  maxTtsCharacters: 900,
  /** Kullanıcı metni (karakter). */
  maxUserTextChars: 500,
  /** Canlı oturum: hareketsizlik ve en uzun süre (istemci uygular; sunucu tur sınırı + hız sınırıyla destekler). */
  idleSessionMs: 45_000,
  maxLiveSessionMs: 10 * 60_000,
} as const;
