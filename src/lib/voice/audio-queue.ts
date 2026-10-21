/**
 * Akan yanıt sesi kuyruğu (Web Audio). Cümle başına gelen ses parçaları SIRAYLA, boşluksuz çalınır.
 *
 * Nesil (generation): `cancel()` nesli artırır, çalan kaynağı hemen durdurur ve kuyruğu boşaltır; eski nesle ait, hâlâ
 * çözülmekte olan parçalar geldiğinde sessizce atılır → araya girmeden sonra eski yanıtın sesi ASLA çalmaz.
 * Saf mantık küçük bir AudioContext alt kümesine bağlıdır (testte sahte bağlamla sürülür).
 */
export type QueueContext = {
  readonly currentTime: number;
  readonly destination: unknown;
  decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }>;
  createBufferSource(): QueueSource;
};
export type QueueSource = {
  buffer: unknown;
  onended: (() => void) | null;
  connect(node: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
};

export type AudioQueueHandlers = {
  /** İlk parça çalmaya başladı (bu nesilde). */
  onStart?: () => void;
  /** Akış bitti ve tüm parçalar çalındı. */
  onIdle?: (playedMs: number) => void;
};

export class AudioPlaybackQueue {
  private generation = 0;
  private pending: Promise<void> = Promise.resolve();
  private sources = new Set<QueueSource>();
  private nextStart = 0;
  private startedAt: number | null = null;
  private scheduledMs = 0;
  private streamEnded = false;
  private started = false;
  private idleFired = false;

  constructor(
    private readonly ctx: QueueContext,
    private readonly handlers: AudioQueueHandlers = {},
  ) {}

  get gen(): number {
    return this.generation;
  }

  /** Çalan ya da sırada bekleyen ses var mı? */
  get busy(): boolean {
    return this.sources.size > 0;
  }

  /** Bu nesilde şu ana kadar çalınan süre (ms). */
  get playedMs(): number {
    if (this.startedAt === null) return 0;
    return Math.max(0, Math.min(this.scheduledMs, (this.ctx.currentTime - this.startedAt) * 1000));
  }

  /** Yeni yanıt: önceki nesli geçersiz kıl ve sayaçları sıfırla. */
  begin(): number {
    this.cancel();
    return this.generation;
  }

  enqueue(data: ArrayBuffer, gen = this.generation): void {
    if (gen !== this.generation) return;
    this.pending = this.pending.then(async () => {
      if (gen !== this.generation) return;
      let buffer: { duration: number };
      try {
        buffer = await this.ctx.decodeAudioData(data);
      } catch {
        return; // bozuk parça atlanır; metin zaten ekranda
      }
      if (gen !== this.generation) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      const when = Math.max(this.ctx.currentTime, this.nextStart);
      if (this.startedAt === null) this.startedAt = when;
      this.nextStart = when + buffer.duration;
      this.scheduledMs += buffer.duration * 1000;
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        if (gen === this.generation) this.checkIdle();
      };
      source.start(when);
      if (!this.started) {
        this.started = true;
        this.handlers.onStart?.();
      }
    });
  }

  /** Sunucu akışı bitti: kalan parçalar çalınınca `onIdle` çağrılır. */
  end(gen = this.generation): void {
    if (gen !== this.generation) return;
    this.pending = this.pending.then(() => {
      if (gen !== this.generation) return;
      this.streamEnded = true;
      this.checkIdle();
    });
  }

  /** Hemen sustur: nesli artır, kaynakları durdur. Çalınan süreyi döner. */
  cancel(): number {
    const played = this.playedMs;
    this.generation += 1;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* zaten durdu */
      }
    }
    this.sources.clear();
    this.pending = Promise.resolve();
    this.nextStart = 0;
    this.startedAt = null;
    this.scheduledMs = 0;
    this.streamEnded = false;
    this.started = false;
    this.idleFired = false;
    return played;
  }

  private checkIdle() {
    if (!this.streamEnded || this.sources.size > 0 || this.idleFired) return;
    this.idleFired = true;
    this.handlers.onIdle?.(this.scheduledMs);
  }
}
