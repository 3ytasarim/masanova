/**
 * Tarayıcı ses yakalama (yalnızca istemci). Kurallar:
 *  - Mikrofon YALNIZCA kullanıcı dokununca istenir (sayfa açılışında asla).
 *  - Tek ifade: dokun → konuş → "Konuşmayı Bitir" ya da sessizlik (konuşma algılandıktan ~1,5 sn sonra) → biter.
 *  - Üst sınır MAX_UTTERANCE_MS; aşılırsa kayıt kendiliğinden durur. Kapatınca / iptalde akış izleri durdurulur.
 *  - Ses yalnızca bellekte tutulur ve sunucuya bir kez gönderilir; tarayıcıda da saklanmaz.
 */
import { MAX_UTTERANCE_MS } from "@/lib/voice/session";

export type Recording = { blob: Blob; mimeType: string; durationMs: number };

export type RecorderHandle = {
  /** Kaydı bitir ve sesi döndür. */
  stop: () => Promise<Recording>;
  /** Kaydı at (panel kapandı vb.). */
  cancel: () => void;
};

export class MicrophoneError extends Error {
  constructor(readonly reason: "denied" | "unsupported") {
    super(reason);
  }
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const c of candidates) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  return "";
}

export async function startRecording(options: { onAutoStop: () => void; maxMs?: number }): Promise<RecorderHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new MicrophoneError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    throw new MicrophoneError("denied");
  }
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  const started = performance.now();
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  // Basit ifade sonu algısı: konuşma duyulduktan sonra ~1,5 sn sessizlik → otomatik bitir.
  let audioCtx: AudioContext | null = null;
  let raf = 0;
  try {
    audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let heard = false;
    let silentSince = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      const now = performance.now();
      if (peak > 12) {
        heard = true;
        silentSince = 0;
      } else if (heard) {
        silentSince ||= now;
        if (now - silentSince > 1500) return options.onAutoStop();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch {
    /* analiz yok: kullanıcı elle bitirir */
  }
  const limit = setTimeout(() => options.onAutoStop(), options.maxMs ?? MAX_UTTERANCE_MS);
  recorder.start(250);

  const cleanup = () => {
    clearTimeout(limit);
    cancelAnimationFrame(raf);
    void audioCtx?.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    stop: () =>
      new Promise<Recording>((resolve) => {
        const finish = () => {
          cleanup();
          const type = recorder.mimeType || mime || "audio/webm";
          resolve({ blob: new Blob(chunks, { type }), mimeType: type, durationMs: Math.round(performance.now() - started) });
        };
        if (recorder.state === "inactive") return finish();
        recorder.onstop = finish;
        recorder.stop();
      }),
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* zaten durdu */
      }
      chunks.length = 0;
      cleanup();
    },
  };
}
