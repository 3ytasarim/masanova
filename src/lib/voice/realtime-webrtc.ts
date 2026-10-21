/**
 * OpenAI Realtime (sesten sese) WebRTC istemcisi — tarayıcı.
 *
 * Bağlantı: sunucunun verdiği KISA ÖMÜRLÜ anahtarla SDP alışverişi (asıl API anahtarı tarayıcıya gelmez). Mikrofon izi
 * doğrudan gönderilir; model sesi uzak iz olarak gelir ve <audio> ile çalınır. Araya girme sunucu VAD'ı ile doğaldır:
 * müşteri konuşmaya başlayınca model susar (çalınmamış ses atılır).
 *
 * Olaylar "oai-events" veri kanalından gelir; bu sınıf yalnızca ihtiyaç duyulanları üst katmana iletir:
 * durum (dinliyor / düşünüyor / konuşuyor), araç çağrısı, tur metinleri, kullanım, hata.
 */
export type RealtimeState = "connecting" | "listening" | "user_speaking" | "thinking" | "speaking" | "closed" | "error";

export type RealtimeTurnStats = {
  userText: string;
  reply: string;
  inputTokens: number;
  outputTokens: number;
  firstAudioMs: number | null;
  totalMs: number;
  audioInMs: number;
  audioOutMs: number;
  interrupted: boolean;
  tools: string[];
};

export type RealtimeHandlers = {
  onState: (state: RealtimeState) => void;
  /** Araç çağrısı: sonucu (JSON) döndür; istemci modele iletir ve yanıtı sürdürür. */
  onToolCall: (name: string, args: unknown) => Promise<Record<string, unknown>>;
  onTurn: (stats: RealtimeTurnStats) => void;
  onError: (code: string) => void;
  /** Model ses izi geldi (ses seviyesi görselleştirmesi için). */
  onRemoteStream?: (stream: MediaStream) => void;
};

type ServerEvent = { type: string; [k: string]: unknown };

/** Sunucunun oturumda kurduğu dönüş algılamasıyla AYNI (karşılamadan sonra geri açılır). */
const TURN_DETECTION = { type: "semantic_vad", eagerness: "high", create_response: true, interrupt_response: true } as const;

export class RealtimeVoiceClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private state: RealtimeState = "connecting";
  // Tur ölçümü
  private speechStartedAt = 0;
  private speechStoppedAt = 0;
  private audioInMs = 0;
  private firstAudioAt = 0;
  private replyText = "";
  private userText = "";
  private tools: string[] = [];
  private interrupted = false;
  private responding = false;
  private pendingTools = 0;
  private usage = { input: 0, output: 0 };
  private outputStartedAt = 0;
  private greeting = false;
  /** Son konuşmaların tanınan metni (sunucu varyant / seçim tahminini bununla engeller). */
  private heardLog: string[] = [];
  private pendingTranscripts = 0;

  constructor(private readonly handlers: RealtimeHandlers) {}

  /** Mikrofon iznini al (kullanıcı dokunuşu içinde çağrılmalı). */
  static async requestMicrophone(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  }

  get muted(): boolean {
    return !(this.mic?.getAudioTracks()[0]?.enabled ?? true);
  }

  /**
   * Müşterinin son söyledikleri; tanıma sürüyorsa en fazla 2,5 sn bekler. Son ifadenin metni hâlâ gelmediyse null
   * (eksik metinle doğru seçim reddedilmesin → sunucu bu durumda denetimi atlar).
   */
  async heard(): Promise<string | null> {
    const until = Date.now() + 2500;
    while (this.pendingTranscripts > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (this.pendingTranscripts > 0) return null;
    return this.heardLog.slice(-3).join(" | ") || null;
  }

  setMuted(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** Model sesini çalan öğe (kullanıcı dokunuşu içinde oluşturulup çalınmalı → iOS otomatik oynatma engeli aşılır). */
  attachAudio(el: HTMLAudioElement) {
    this.audioEl = el;
  }

  async connect(input: { clientSecret: string; mic: MediaStream }): Promise<void> {
    this.setState("connecting");
    this.mic = input.mic;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = (e) => {
      if (this.audioEl) {
        this.audioEl.srcObject = e.streams[0] ?? null;
      }
      if (e.streams[0]) this.handlers.onRemoteStream?.(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.fail("connection_lost");
    };
    for (const track of input.mic.getAudioTracks()) pc.addTrack(track, input.mic);
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (m) => {
      try {
        this.onEvent(JSON.parse(String(m.data)) as ServerEvent);
      } catch {
        /* bozuk olay yok sayılır */
      }
    };
    const opened = new Promise<void>((resolve, reject) => {
      dc.onopen = () => resolve();
      setTimeout(() => reject(new Error("timeout")), 15_000);
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${input.clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!res.ok) throw new Error(`sdp_${res.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    await opened;
    this.setState("listening");
  }

  /** Açılış: garson masaya gelir gibi karşılar (ses çalınabilir olduğunda çağrılır). */
  greet(instructions: string) {
    // Karşılama kesilmesin (ortam gürültüsü araya girme sayılmasın): bitene kadar dinleme kapalı, sonra hemen açılır.
    this.greeting = true;
    this.send({ type: "session.update", session: { type: "realtime", audio: { input: { turn_detection: null } } } });
    this.send({ type: "response.create", response: { instructions } });
    this.setState("thinking");
    // Güvenlik: ses bitiş olayı gelmezse dinleme yine açılır.
    setTimeout(() => this.endGreeting(), 12_000);
  }

  private endGreeting() {
    if (!this.greeting) return;
    this.greeting = false;
    this.send({ type: "input_audio_buffer.clear" });
    this.send({ type: "session.update", session: { type: "realtime", audio: { input: { turn_detection: TURN_DETECTION } } } });
  }

  close() {
    this.setState("closed");
    try {
      this.dc?.close();
    } catch {
      /* yok say */
    }
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) this.audioEl.srcObject = null;
    this.pc = null;
    this.dc = null;
    this.mic = null;
  }

  private send(event: Record<string, unknown>) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  private setState(next: RealtimeState) {
    if (this.state === next || this.state === "closed") return;
    this.state = next;
    this.handlers.onState(next);
  }

  private fail(code: string) {
    if (this.state === "closed") return;
    this.handlers.onError(code);
    this.setState("error");
  }

  private resetTurn() {
    this.replyText = "";
    this.userText = "";
    this.tools = [];
    this.interrupted = false;
    this.firstAudioAt = 0;
    this.outputStartedAt = 0;
    this.usage = { input: 0, output: 0 };
    this.audioInMs = 0;
  }

  private finishTurn() {
    const now = Date.now();
    const base = this.speechStoppedAt || now;
    this.handlers.onTurn({
      userText: this.userText,
      reply: this.replyText.trim(),
      inputTokens: this.usage.input,
      outputTokens: this.usage.output,
      firstAudioMs: this.firstAudioAt ? Math.max(0, this.firstAudioAt - base) : null,
      totalMs: Math.max(0, now - base),
      audioInMs: this.audioInMs,
      audioOutMs: this.outputStartedAt ? now - this.outputStartedAt : 0,
      interrupted: this.interrupted,
      tools: this.tools,
    });
    this.resetTurn();
  }

  private onEvent(e: ServerEvent) {
    switch (e.type) {
      case "input_audio_buffer.speech_started": {
        // Model konuşuyorsa bu bir araya girmedir (sunucu yanıtı keser, çalınmamış ses atılır).
        if (this.responding) this.interrupted = true;
        this.speechStartedAt = Date.now();
        this.setState("user_speaking");
        break;
      }
      case "input_audio_buffer.speech_stopped": {
        this.speechStoppedAt = Date.now();
        this.audioInMs += this.speechStoppedAt - (this.speechStartedAt || this.speechStoppedAt);
        this.setState("thinking");
        break;
      }
      case "input_audio_buffer.committed":
        this.pendingTranscripts += 1;
        break;
      case "conversation.item.input_audio_transcription.failed":
        this.pendingTranscripts = Math.max(0, this.pendingTranscripts - 1);
        break;
      case "conversation.item.input_audio_transcription.completed": {
        this.pendingTranscripts = Math.max(0, this.pendingTranscripts - 1);
        const t = String(e.transcript ?? "").trim();
        if (t && !/^(restoran siparişi|menü:)/i.test(t)) this.heardLog = [...this.heardLog, t].slice(-6);
        // Gürültüde tanıma modeli ipucunu (menü sözlüğü) aynen yazabilir → konuşma metni sayılmaz.
        if (t && !/^(restoran siparişi|menü:)/i.test(t)) this.userText = this.userText ? `${this.userText} ${t}` : t;
        break;
      }
      case "response.created":
        this.responding = true;
        break;
      case "output_audio_buffer.started":
      case "response.output_audio.delta": {
        if (!this.firstAudioAt) this.firstAudioAt = Date.now();
        if (!this.outputStartedAt) this.outputStartedAt = Date.now();
        this.setState("speaking");
        break;
      }
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        this.endGreeting();
        if (!this.responding && !this.pendingTools) this.setState("listening");
        break;
      }
      case "response.output_audio_transcript.done": {
        this.replyText += ` ${String(e.transcript ?? "")}`;
        break;
      }
      case "response.function_call_arguments.done": {
        const name = String(e.name ?? "");
        const callId = String(e.call_id ?? "");
        let args: unknown = {};
        try {
          args = JSON.parse(String(e.arguments ?? "{}"));
        } catch {
          args = null;
        }
        this.tools.push(name);
        this.pendingTools += 1;
        this.setState("thinking");
        void this.handlers
          .onToolCall(name, args)
          .catch(() => ({ ok: false, error: "tool_failed" }))
          .then((output) => {
            this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output).slice(0, 8000) } });
            this.pendingTools -= 1;
            // Tüm araç sonuçları iletilince model konuşmayı sürdürür.
            if (!this.pendingTools) this.send({ type: "response.create" });
          });
        break;
      }
      case "response.done": {
        this.responding = false;
        const r = e.response as { status?: string; usage?: { input_tokens?: number; output_tokens?: number }; output?: { type?: string }[] } | undefined;
        this.usage.input += r?.usage?.input_tokens ?? 0;
        this.usage.output += r?.usage?.output_tokens ?? 0;
        if (r?.status === "cancelled") this.interrupted = true;
        if (r?.status === "failed") this.handlers.onError("response_failed");
        const calledTool = r?.output?.some((o) => o.type === "function_call");
        // Araç çağıran yanıt ara adımdır; tur, sesli yanıt bitince kapanır.
        if (!calledTool && !this.pendingTools) {
          this.finishTurn();
          if (this.state !== "speaking") this.setState("listening");
        }
        break;
      }
      case "error": {
        const err = e.error as { code?: string; type?: string } | undefined;
        // Zararsız: iptal edilecek yanıt yok (araya girme yarışı).
        if (err?.code === "response_cancel_not_active") break;
        this.handlers.onError(err?.code ?? err?.type ?? "provider_error");
        break;
      }
    }
  }
}
