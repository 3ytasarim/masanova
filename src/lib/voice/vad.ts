import { VAD_CONFIG } from "@/lib/voice/config";

/**
 * Ses etkinliği algılayıcı (saf, kare tabanlı — testte sentetik karelerle sürülür).
 * Uyarlanır gürültü tabanı: yalnızca sessiz karelerde EMA ile güncellenir (restoran müziği / uğultu tabanı yükseltir,
 * konuşma eşiği onunla birlikte yükselir). Konuşma başlangıcı `minSpeechMs` kesintisiz konuşma ister (tıkırtı / tabak sesi
 * tek karelik tepe yapar → sayılmaz). İfade sonu `silenceMs` sessizlik; `maxUtteranceMs` üst sınır.
 * `mode: "barge-in"` (asistan konuşurken): daha yüksek oran ve daha uzun süre — yankı / sızıntı yanlış kesmesin.
 */
export type VadEvent = "speech_start" | "speech_end" | "max_reached" | null;
export type VadConfig = { [K in keyof typeof VAD_CONFIG]: number };

export class VoiceActivityDetector {
  private noise: number;
  private speaking = false;
  private aboveMs = 0;
  private belowMs = 0;
  private utteranceMs = 0;
  mode: "normal" | "barge-in" = "normal";

  constructor(private readonly config: VadConfig = VAD_CONFIG, initialNoise = 0.004) {
    this.noise = initialNoise;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get noiseFloor(): number {
    return this.noise;
  }

  threshold(): number {
    const ratio = this.mode === "barge-in" ? this.config.bargeInRatio : this.config.speechRatio;
    return Math.max(this.config.minSpeechRms, this.noise * ratio);
  }

  reset(): void {
    this.speaking = false;
    this.aboveMs = 0;
    this.belowMs = 0;
    this.utteranceMs = 0;
  }

  /** Bir kare işle (rms 0–1). */
  push(rms: number, frameMs = this.config.frameMs): VadEvent {
    const loud = rms >= this.threshold();
    if (!this.speaking) {
      if (loud) {
        this.aboveMs += frameMs;
        const need = this.mode === "barge-in" ? this.config.bargeInMs : this.config.minSpeechMs;
        if (this.aboveMs >= need) {
          this.speaking = true;
          this.belowMs = 0;
          this.utteranceMs = this.aboveMs;
          return "speech_start";
        }
      } else {
        this.aboveMs = 0;
        this.noise = this.noise + (rms - this.noise) * this.config.noiseAdapt;
      }
      return null;
    }
    this.utteranceMs += frameMs;
    if (this.utteranceMs >= this.config.maxUtteranceMs) {
      this.reset();
      return "max_reached";
    }
    if (loud) this.belowMs = 0;
    else {
      this.belowMs += frameMs;
      if (this.belowMs >= this.config.silenceMs) {
        this.reset();
        return "speech_end";
      }
    }
    return null;
  }
}

export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, samples.length));
}
