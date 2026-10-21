/**
 * Canlı mod mikrofon yakalama (yalnızca istemci). AudioWorklet (ses iş parçacığı; yoksa ScriptProcessor yedeği) ile ham PCM: her kare VAD'den geçer, konuşma
 * başlayınca ön tampon (pre-roll) dahil biriktirilir, ifade bitince 16 kHz WAV'a çevrilip TEK ifade olarak verilir.
 *
 *  - Mikrofon YALNIZCA kullanıcının açık dokunuşuyla açılır (sürekli / uyandırma kelimesi dinleme yok).
 *  - Yankı giderme + gürültü bastırma + otomatik kazanç tarayıcıdan istenir (restoran gürültüsü).
 *  - Ham ses saklanmaz: ifade bellekte birikir, gönderilir, atılır. `stop()` izleri ve düğümleri kapatır.
 *  - Mikrofon izi biterse (cihaz çıkarıldı / izin geri alındı) `onDeviceLost` çağrılır.
 */
import { CAPTURE_SAMPLE_RATE, VAD_CONFIG } from "@/lib/voice/config";
import { rmsOf, VoiceActivityDetector } from "@/lib/voice/vad";
import { encodeWav, resample } from "@/lib/voice/wav";

export class MicrophoneUnavailable extends Error {
  constructor(readonly reason: "denied" | "unsupported" | "device") {
    super(reason);
  }
}

export type Utterance = { wav: Uint8Array; durationMs: number };

/** Saf ifade biriktirici: ön tampon halkası + konuşma süresince kareler. */
export class UtteranceCollector {
  private ring: Float32Array[] = [];
  private ringMs = 0;
  private chunks: Float32Array[] = [];
  private collecting = false;

  constructor(private readonly preRollMs: number = VAD_CONFIG.preRollMs) {}

  get active(): boolean {
    return this.collecting;
  }

  push(frame: Float32Array, frameMs: number): void {
    if (this.collecting) {
      this.chunks.push(frame);
      return;
    }
    this.ring.push(frame);
    this.ringMs += frameMs;
    while (this.ring.length > 1 && this.ringMs - frameMs >= this.preRollMs) {
      this.ring.shift();
      this.ringMs -= frameMs;
    }
  }

  start(): void {
    this.collecting = true;
    this.chunks = [...this.ring];
    this.ring = [];
    this.ringMs = 0;
  }

  /** Biriktirilen sesi tek dizi olarak verir ve sıfırlar. */
  finish(): Float32Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    this.collecting = false;
    return out;
  }

  discard(): void {
    this.chunks = [];
    this.collecting = false;
  }
}

export type CaptureHandlers = {
  onSpeechStart: () => void;
  onUtterance: (u: Utterance) => void;
  /** 0–1 seviye (görsel için). */
  onLevel?: (level: number) => void;
  onDeviceLost: () => void;
};

export type CaptureMode = "worklet" | "script-processor";

export type CaptureHandle = {
  /** Kullanılan yakalama yolu (AudioWorklet tercih edilir; yoksa / yüklenemezse ScriptProcessor). */
  readonly mode: CaptureMode;
  setMode(mode: "normal" | "barge-in"): void;
  /** Konuşma algılanırken biriken ifadeyi at (ör. oturum bitti). */
  discard(): void;
  stop(): void;
};

/** AudioWorklet modülü — SABİT, aynı origin'li yol (CSP script-src 'self'; uzak / kullanıcı verisi URL yüklenmez). */
export const CAPTURE_WORKLET_URL = "/worklets/capture-processor.js";
export const CAPTURE_WORKLET_NAME = "masanova-capture";

/** Yakalama yolu seçimi (saf): AudioWorklet varsa onu, yoksa eski ScriptProcessor yedeği. */
export function selectCaptureMode(env: { audioWorklet: boolean; audioWorkletNode: boolean; forceLegacy?: boolean }): CaptureMode {
  return !env.forceLegacy && env.audioWorklet && env.audioWorkletNode ? "worklet" : "script-processor";
}

/** Modül adresinin sayfayla aynı origin'de olduğunu doğrula (savunma: sabit dışında bir adres asla yüklenmez). */
export function isSameOriginModule(url: string, origin: string): boolean {
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

const loadedContexts = new WeakSet<BaseAudioContext>();

async function loadWorklet(ctx: AudioContext): Promise<boolean> {
  if (loadedContexts.has(ctx)) return true;
  if (!isSameOriginModule(CAPTURE_WORKLET_URL, window.location.origin)) return false;
  try {
    await ctx.audioWorklet.addModule(CAPTURE_WORKLET_URL);
    loadedContexts.add(ctx);
    return true;
  } catch {
    return false;
  }
}

/** Paylaşılan AudioContext üzerinde yakalama başlat (bağlamı çağıran yönetir ve kapatır). */
export async function startCapture(ctx: AudioContext, handlers: CaptureHandlers, options: { forceLegacy?: boolean } = {}): Promise<CaptureHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new MicrophoneUnavailable("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new MicrophoneUnavailable(name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError" ? "device" : "denied");
  }
  const source = ctx.createMediaStreamSource(stream);
  const sink = ctx.createGain();
  sink.gain.value = 0; // işlemcinin çalışması için hedefe bağlı ama SESSİZ (yankı yok)
  const vad = new VoiceActivityDetector();
  const collector = new UtteranceCollector();
  let stopped = false;

  /** Ortak kare işleme (her iki yakalama yolu): seviye → ön tampon → VAD → ifade. */
  const onFrame = (frame: Float32Array) => {
    if (stopped) return;
    const frameMs = (frame.length / ctx.sampleRate) * 1000;
    const rms = rmsOf(frame);
    handlers.onLevel?.(Math.min(1, rms / Math.max(vad.threshold() * 2, 0.02)));
    collector.push(frame, frameMs);
    const ev = vad.push(rms, frameMs);
    if (ev === "speech_start") {
      collector.start();
      handlers.onSpeechStart();
    } else if (ev === "speech_end" || ev === "max_reached") {
      const pcm = collector.finish();
      const wav = encodeWav(resample(pcm, ctx.sampleRate, CAPTURE_SAMPLE_RATE), CAPTURE_SAMPLE_RATE);
      handlers.onUtterance({ wav, durationMs: Math.round((pcm.length / ctx.sampleRate) * 1000) });
    }
  };

  let mode = selectCaptureMode({ audioWorklet: !!ctx.audioWorklet, audioWorkletNode: typeof AudioWorkletNode !== "undefined", forceLegacy: options.forceLegacy });
  let node: AudioNode;
  let detach: () => void;
  if (mode === "worklet" && (await loadWorklet(ctx))) {
    const worklet = new AudioWorkletNode(ctx, CAPTURE_WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
    node = worklet;
    detach = () => {
      worklet.port.onmessage = null;
      worklet.port.postMessage("stop");
      worklet.port.close();
    };
  } else {
    // Yedek: AudioWorklet yok ya da modül yüklenemedi (eski tarayıcı / kısıtlı ortam).
    mode = "script-processor";
    const processor = ctx.createScriptProcessor(1024, 1, 1);
    processor.onaudioprocess = (event) => onFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
    node = processor;
    detach = () => {
      processor.onaudioprocess = null;
    };
  }
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);

  const track = stream.getAudioTracks()[0];
  const onEnded = () => {
    if (!stopped) handlers.onDeviceLost();
  };
  track?.addEventListener("ended", onEnded);

  return {
    mode,
    setMode(m) {
      vad.mode = m;
    },
    discard() {
      collector.discard();
      vad.reset();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      track?.removeEventListener("ended", onEnded);
      detach();
      try {
        source.disconnect();
        node.disconnect();
        sink.disconnect();
      } catch {
        /* zaten ayrık */
      }
      stream.getTracks().forEach((t) => t.stop());
      collector.discard();
    },
  };
}
