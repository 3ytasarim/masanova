/**
 * MasaNova mikrofon yakalama AudioWorklet işlemcisi (aynı origin'den yüklenir — CSP script-src 'self').
 * Ses iş parçacığında çalışır: 128 örneklik kareleri 1024 örneklik bloklara toplar ve ana iş parçacığına aktarır
 * (aktarılabilir tampon, kopya yok). VAD / ifade biriktirme ana iş parçacığında (src/lib/voice/pcm-capture.ts).
 * "stop" mesajında işlemci kendini sonlandırır (process → false) — düğüm çöp toplayıcıya bırakılır, sızıntı yok.
 * Ham ses hiçbir yere gönderilmez / saklanmaz; yalnızca aynı sayfadaki yakalama koduna verilir.
 */
const BLOCK = 1024;

class MasaNovaCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BLOCK);
    this.filled = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        this.running = false;
        this.port.onmessage = null;
      }
    };
  }

  process(inputs) {
    if (!this.running) return false;
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(BLOCK - this.filled, channel.length - offset);
        this.buffer.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === BLOCK) {
          const out = this.buffer;
          this.port.postMessage(out, [out.buffer]);
          this.buffer = new Float32Array(BLOCK);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("masanova-capture", MasaNovaCaptureProcessor);
