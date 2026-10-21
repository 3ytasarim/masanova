import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startFakeRedis, type FakeRedis } from "../support/fake-redis";

// Redis istemci modülü: testler bağlantıyı kendisi verir (sahte Redis ya da kapalı port).
const redisMock = vi.hoisted(() => ({ client: null as unknown, ns: "test" }));
vi.mock("@/lib/redis/client", async () => {
  const { REDIS_OPTIONS } = await vi.importActual<{ REDIS_OPTIONS: object }>("@/lib/redis/client").catch(() => ({ REDIS_OPTIONS: {} }));
  return {
    REDIS_OPTIONS,
    getRedis: () => redisMock.client,
    namespace: () => redisMock.ns,
    redisConfigured: () => !!redisMock.client,
    waitReady: async (client: Redis, ms = 300) => {
      if (client.status === "ready") return true;
      return new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), ms);
        client.once("ready", () => {
          clearTimeout(t);
          resolve(true);
        });
      });
    },
  };
});

const { redisNamespace, rateLimitKey, hashSubject, realtimeRedisChannel, parseRealtimeRedisChannel, isRealtimeChannel } = await import("@/lib/redis/keys");
const { createRedisBackend, createMemoryBackend } = await import("@/server/rate-limit/providers");
const { rateLimit, rateLimitAll, resetRateLimitStateForTests } = await import("@/server/rate-limit");
const { RATE_LIMIT_POLICIES } = await import("@/server/rate-limit/policies");
const { RedisProvider, InMemoryProvider } = await import("@/server/realtime/providers");
const { envelope } = await import("@/lib/realtime/events");
const { onShutdown, runShutdown, isShuttingDown, resetShutdownForTests } = await import("@/server/lifecycle/shutdown");
const { selectCaptureMode, isSameOriginModule, CAPTURE_WORKLET_URL } = await import("@/lib/voice/pcm-capture");
const { isPublicAddress } = await import("@/lib/security/ip");
const { assertFetchableUrl, createGuardedLookup, safeFetch, SsrfBlockedError } = await import("@/server/security/safe-fetch");
const { diagnoseEnv, summarizeEnv, ENV_SPECS } = await import("@/lib/env-diagnostics");
const { redact, redactText, REDACTED } = await import("@/lib/observability/redact");
const { log, setLogSink, setErrorReporter } = await import("@/lib/observability/logger");
const { newCorrelationId, isValidCorrelationId, correlationIdFrom } = await import("@/lib/observability/correlation");
const { metrics } = await import("@/lib/observability/metrics");
const { ERROR_CODES, providerErrorCode } = await import("@/lib/observability/errors");
const { planHasFeature, FEATURES } = await import("@/config/plans");
const { readJsonBody, BODY_LIMITS } = await import("@/lib/security/body");
const { AI_LIMITS } = await import("@/lib/ai/limits");
const { reconnectBackoff, SESSION_LIMITS } = await import("@/lib/voice/config");
const { scanText } = await import("../../scripts/secret-scan.mjs");

/** Sprint 11 — üretim sertleştirme: Redis anahtarları, dağıtık hız sınırı, olay yolu, kapanış, SSRF, gözlemlenebilirlik. */

let fake: FakeRedis;
const conns: Redis[] = [];
const connect = (port = fake.port) => {
  const c = new Redis({ host: "127.0.0.1", port, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1000, retryStrategy: (t) => Math.min(t * 50, 300), lazyConnect: false });
  c.on("error", () => undefined);
  conns.push(c);
  return c;
};
const ready = (c: Redis) => (c.status === "ready" ? Promise.resolve() : new Promise<void>((r) => c.once("ready", () => r())));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  fake = await startFakeRedis();
});
afterAll(async () => {
  for (const c of conns) c.disconnect();
  await fake.close();
});
afterEach(() => {
  redisMock.client = null;
  resetRateLimitStateForTests();
});

describe("Redis anahtar / kanal adları", () => {
  it("ad alanı temizlenir; özne ham yazılmaz (özet); politika adı doğrulanır", () => {
    expect(redisNamespace("Prod")).toBe("prod");
    expect(redisNamespace("bad ns!")).toBe("default");
    expect(redisNamespace(undefined)).toBe("default");
    const key = rateLimitKey("prod", "auth.login", "ayse@example.com|10.0.0.1");
    expect(key).toMatch(/^mn:prod:rl:auth\.login:[0-9a-f]{32}$/);
    expect(key).not.toContain("example.com");
    expect(hashSubject("a")).not.toBe(hashSubject("b"));
    expect(() => rateLimitKey("prod", "x:y", "s")).toThrow();
  });

  it("yalnızca sunucunun kanal biçimleri; joker / enjeksiyon reddedilir; başka ad alanı yok sayılır", () => {
    expect(realtimeRedisChannel("prod", "tenant:abc123:orders")).toBe("mn:prod:rt:tenant:abc123:orders");
    for (const bad of ["tenant:*:orders", "tenant:a:orders:x", "order:", "table:a\nPUBLISH", "user:1", "tenant:a b:orders", "*"]) {
      expect(isRealtimeChannel(bad)).toBe(false);
      expect(() => realtimeRedisChannel("prod", bad)).toThrow();
    }
    expect(parseRealtimeRedisChannel("prod", "mn:prod:rt:order:o1")).toBe("order:o1");
    expect(parseRealtimeRedisChannel("prod", "mn:staging:rt:order:o1")).toBeNull();
    expect(parseRealtimeRedisChannel("prod", "mn:prod:rt:secret:x")).toBeNull();
  });
});

describe("dağıtık hız sınırı (Redis, iki süreç)", () => {
  it("ATOMİK: iki süreçten eşzamanlı 60 vuruş, sınır 20 → tam 20 izin (GET-sonra-SET yarışı yok)", async () => {
    const a = createRedisBackend(connect());
    const b = createRedisBackend(connect());
    await Promise.all(conns.slice(-2).map(ready));
    const key = rateLimitKey("test", "order.submit.table", "table-1");
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? a : b).hit(key, 20, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    expect(results.filter((r) => !r.allowed).every((r) => r.retryAfterSeconds >= 1)).toBe(true);
  });

  it("pencere süresi bir kez konur (NX) ve dolunca sayaç sıfırlanır; reset siler", async () => {
    const c = connect();
    await ready(c);
    const backend = createRedisBackend(c);
    const key = rateLimitKey("test", "auth.login", "u|ip");
    expect((await backend.hit(key, 2, 250)).allowed).toBe(true);
    await sleep(100);
    expect((await backend.hit(key, 2, 250)).allowed).toBe(true); // NX: süre uzamaz
    expect((await backend.hit(key, 2, 250)).allowed).toBe(false);
    await sleep(200);
    expect((await backend.hit(key, 2, 250)).allowed).toBe(true);
    await backend.reset(key);
    expect((await c.get(key))).toBeNull();
  });

  it("rateLimit(): Redis varken paylaşılır; Redis erişilemezse politika yedeği (AI → ret, diğerleri → bellek, sınır KALKMAZ)", async () => {
    const c = connect();
    await ready(c);
    redisMock.client = c;
    const shared = await Promise.all(Array.from({ length: RATE_LIMIT_POLICIES["ai.conversation"].limit + 3 }, () => rateLimit("ai.conversation", "conv-1")));
    expect(shared.every((r) => r.backend === "redis")).toBe(true);
    expect(shared.filter((r) => r.allowed)).toHaveLength(RATE_LIMIT_POLICIES["ai.conversation"].limit);

    // Kapalı port: Redis yapılandırılmış ama erişilemiyor
    const dead = new Redis({ host: "127.0.0.1", port: 1, enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null, lazyConnect: false });
    dead.on("error", () => undefined);
    conns.push(dead);
    redisMock.client = dead;
    const ai = await rateLimit("ai.conversation", "conv-2");
    expect(ai).toMatchObject({ allowed: false, backend: "denied" });
    const order = await Promise.all(Array.from({ length: 10 }, () => rateLimit("order.submit.iptable", "ip|table")));
    expect(order.every((r) => r.backend === "memory")).toBe(true);
    expect(order.filter((r) => r.allowed)).toHaveLength(RATE_LIMIT_POLICIES["order.submit.iptable"].limit); // yedek sınırı yine uygular
    expect(metrics.snapshot().counters["ratelimit.fallback{ai.conversation}"]).toBeGreaterThanOrEqual(1);
  });

  it("Redis yapılandırılmamışsa süreç içi bellek; rateLimitAll hepsini sayar", async () => {
    const r = await rateLimitAll([
      ["service.tabletype", "t1|WAITER"],
      ["service.table", "t1"],
      ["service.ip", "ip"],
    ]);
    expect(r.allowed).toBe(true);
    const mem = createMemoryBackend(() => 0);
    expect((await mem.hit("k", 1, 1000)).allowed).toBe(true);
    expect((await mem.hit("k", 1, 1000)).allowed).toBe(false);
  });

  it("tüm mevcut sınırlar tek politika tablosunda", () => {
    for (const name of ["qr.entry", "order.submit.table", "order.check", "service.table", "ai.conversation", "ai.speech", "auth.login", "demo.ip", "demo.email"]) expect(name in RATE_LIMIT_POLICIES).toBe(true);
    // Ücretli AI çağrısını koruyan politikalar (müşteri AI + İşletme Danışmanı yenilemesi) Redis yokken güvenli RET.
    const paidAi = (name: string) => (name.startsWith("ai.") && name !== "ai.report") || name === "advisor.refresh";
    for (const [name, p] of Object.entries(RATE_LIMIT_POLICIES)) expect(paidAi(name) ? p.onBackendFailure === "deny" : p.onBackendFailure === "memory").toBe(true);
  });
});

describe("gerçek zamanlı olay yolu (Redis Pub/Sub, iki süreç)", () => {
  const ev = () => envelope({ type: "ORDER_SUBMITTED" as const, data: { orderId: "o1", orderNumber: 1001, status: "SUBMITTED" as const } });

  async function processPair() {
    const [pa, sa, pb, sb] = [connect(), connect(), connect(), connect()];
    await Promise.all([pa, sa, pb, sb].map(ready));
    return { A: new RedisProvider(pa, sa, "test"), B: new RedisProvider(pb, sb, "test") };
  }
  const waitFor = async (fn: () => boolean, ms = 2000) => {
    const start = Date.now();
    while (!fn() && Date.now() - start < ms) await sleep(20);
    return fn();
  };

  it("A sürecindeki yayın B sürecindeki aboneye ulaşır; kiracı A olayı kiracı B kanalına SIZMAZ", async () => {
    const { A, B } = await processPair();
    const gotT1: unknown[] = [];
    const gotT2: unknown[] = [];
    B.subscribe("tenant:T1:orders", (e) => gotT1.push(e));
    B.subscribe("tenant:T2:orders", (e) => gotT2.push(e));
    await sleep(100);
    A.publish("tenant:T1:orders", ev());
    expect(await waitFor(() => gotT1.length === 1)).toBe(true);
    await sleep(150);
    expect(gotT2).toHaveLength(0);
    expect(gotT1[0]).toMatchObject({ type: "ORDER_SUBMITTED", version: 1 });
    await A.close();
    await B.close();
  });

  it("geçersiz kanal yayınlanamaz; bozuk / yabancı ad alanı mesajı yok sayılır; son abone gidince UNSUBSCRIBE", async () => {
    const { A, B } = await processPair();
    expect(() => A.publish("tenant:*:orders", ev())).toThrow();
    const got: unknown[] = [];
    const off = B.subscribe("order:o1", (e) => got.push(e));
    await sleep(100);
    const raw = connect();
    await ready(raw);
    await raw.publish("mn:test:rt:order:o1", "{not json");
    await raw.publish("mn:other:rt:order:o1", JSON.stringify(ev()));
    await raw.publish("mn:test:rt:order:o1", JSON.stringify({ ...ev(), version: 99 }));
    await sleep(200);
    expect(got).toHaveLength(0);
    expect(await raw.publish("mn:test:rt:order:o1", JSON.stringify(ev()))).toBe(1);
    off();
    await sleep(100);
    expect(await raw.publish("mn:test:rt:order:o1", JSON.stringify(ev()))).toBe(0);
    await A.close();
    await B.close();
  });

  it("yeniden bağlanma: Redis bağlantıları koparsa abonelik kendiliğinden yenilenir ve olaylar akmaya devam eder", async () => {
    const { A, B } = await processPair();
    const got: unknown[] = [];
    B.subscribe("table:tab1", (e) => got.push(e));
    await sleep(100);
    fake.dropConnections();
    await sleep(800); // yeniden bağlan + yeniden abone ol
    const deadline = Date.now() + 3000;
    while (!got.length && Date.now() < deadline) {
      A.publish("table:tab1", envelope({ type: "SERVICE_REQUEST_CREATED" as const, data: { kind: "WAITER" as const, status: "OPEN" as const } }));
      await sleep(150);
    }
    expect(got.length).toBeGreaterThan(0);
    await A.close();
    await B.close();
  });

  it("bellek sağlayıcı: tek süreç teslimi ve dinleyici temizliği", () => {
    const p = new InMemoryProvider();
    const got: unknown[] = [];
    const off = p.subscribe("order:x", (e) => got.push(e));
    p.publish("order:x", ev());
    off();
    p.publish("order:x", ev());
    expect(got).toHaveLength(1);
    expect(p.listenerCount("order:x")).toBe(0);
  });
});

describe("nazik kapanış", () => {
  it("kancalar öncelik sırasıyla; takılan kanca bütçeyi aşmaz; tekrar çağrı aynı işi bekler", async () => {
    resetShutdownForTests();
    const order: string[] = [];
    onShutdown("redis", 80, () => void order.push("redis"));
    onShutdown("sse", 20, () => void order.push("sse"));
    onShutdown("stuck", 30, () => new Promise(() => undefined));
    onShutdown("prisma", 90, async () => void order.push("prisma"));
    const started = Date.now();
    const p1 = runShutdown("SIGTERM", 600);
    const p2 = runShutdown("SIGTERM", 600);
    expect(isShuttingDown()).toBe(true);
    await Promise.all([p1, p2]);
    expect(order).toEqual(["sse", "redis", "prisma"]);
    expect(Date.now() - started).toBeLessThan(2000);
    resetShutdownForTests();
  });
});

describe("AudioWorklet seçimi ve güvenliği", () => {
  it("AudioWorklet varsa onu, yoksa ScriptProcessor yedeği", () => {
    expect(selectCaptureMode({ audioWorklet: true, audioWorkletNode: true })).toBe("worklet");
    expect(selectCaptureMode({ audioWorklet: false, audioWorkletNode: true })).toBe("script-processor");
    expect(selectCaptureMode({ audioWorklet: true, audioWorkletNode: false })).toBe("script-processor");
    expect(selectCaptureMode({ audioWorklet: true, audioWorkletNode: true, forceLegacy: true })).toBe("script-processor");
  });
  it("worklet modülü sabit ve aynı origin'li; uzak adres reddedilir", () => {
    expect(CAPTURE_WORKLET_URL.startsWith("/")).toBe(true);
    expect(isSameOriginModule(CAPTURE_WORKLET_URL, "https://demo.masanovai.com")).toBe(true);
    for (const bad of ["https://evil.example/x.js", "//evil.example/x.js", "http://demo.masanovai.com/x.js"]) expect(isSameOriginModule(bad, "https://demo.masanovai.com")).toBe(false);
  });
});

describe("SSRF", () => {
  it.each([
    ["8.8.8.8", true],
    ["10.1.2.3", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["172.20.0.1", false],
    ["192.168.0.10", false],
    ["100.100.1.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["::", false],
    ["fd00::1", false],
    ["fe80::1", false],
    ["::ffff:10.0.0.1", false],
    ["::ffff:127.0.0.1", false],
    ["64:ff9b::a9fe:a9fe", false],
    ["2002:c0a8:1::1", false],
    ["2606:4700:4700::1111", true],
  ])("%s → public=%s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it("URL ön denetimi: yalnızca https:443, kimlik bilgisiz, IP literal / yerel ad yok", () => {
    expect(assertFetchableUrl("https://cdn.example.com/logo.png").hostname).toBe("cdn.example.com");
    for (const bad of ["http://cdn.example.com/a.png", "https://cdn.example.com:8443/a.png", "https://u:p@cdn.example.com/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://localhost/a.png", "https://x.internal/a.png", "https://metadata/a", "file:///etc/passwd"]) {
      expect(() => assertFetchableUrl(bad)).toThrow(SsrfBlockedError);
    }
  });

  it("DNS rebinding: bağlantı anındaki çözümleme özel adres döndürürse (tek kayıt bile) bağlantı KURULMAZ", async () => {
    const lookupWith = (addresses: { address: string; family: number }[]) =>
      new Promise<{ error: unknown; address: unknown }>((resolve) => {
        const fn = createGuardedLookup((_h, cb) => cb(null, addresses));
        (fn as unknown as (h: string, o: object, cb: (e: unknown, a: unknown) => void) => void)("cdn.example.com", {}, (error, address) => resolve({ error, address }));
      });
    expect((await lookupWith([{ address: "93.184.216.34", family: 4 }])).address).toBe("93.184.216.34");
    expect((await lookupWith([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }])).error).toBeInstanceOf(SsrfBlockedError);
    expect((await lookupWith([{ address: "fd12::1", family: 6 }])).error).toBeInstanceOf(SsrfBlockedError);
    expect((await lookupWith([])).error).toBeInstanceOf(SsrfBlockedError);
    // safeFetch: çözücü özel adres verir → ağ bağlantısı denenmeden SsrfBlockedError
    await expect(safeFetch("https://rebind.example.com/logo.png", { maxBytes: 1000, timeoutMs: 2000, resolver: (_h, cb) => cb(null, [{ address: "169.254.169.254", family: 4 }]) })).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch("https://rebind.example.com/logo.png", { maxBytes: 1000, timeoutMs: 2000, resolver: (_h, cb) => cb(null, [{ address: "::1", family: 6 }]) })).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("ortam doğrulama", () => {
  it("sınıflandırma; çıktı değer içermez; AI eksikse çekirdek yine sağlam", () => {
    const secretValue = "postgresql://user:SuperSecretPw123@host.neon.tech/db"; // secret-scan:allow — sahte test değeri
    const d = diagnoseEnv({ DATABASE_URL: secretValue, DIRECT_URL: secretValue, QR_TOKEN_SECRET: "x".repeat(40), NEXT_PUBLIC_APP_URL: "https://masanovai.com", NEXT_PUBLIC_ROOT_DOMAIN: "masanovai.com", AI_PROVIDER: "openai", REDIS_URL: "http://wrong" });
    expect(JSON.stringify(d)).not.toContain("SuperSecretPw123");
    expect(d.find((x) => x.name === "REDIS_URL")?.status).toBe("invalid");
    const s = summarizeEnv(d, { production: true, aiProvider: "openai" });
    expect(s.coreOk).toBe(true);
    expect(s.aiConfigured).toBe(false);
    expect(s.warnings.join(" ")).toMatch(/AI_API_KEY/);
    expect(s.warnings.join(" ")).toMatch(/QR_ENTRY_ORIGIN/);
    expect(ENV_SPECS.filter((e) => e.class === "core").map((e) => e.name)).toEqual(expect.arrayContaining(["DATABASE_URL", "DIRECT_URL", "QR_TOKEN_SECRET"]));
    expect(summarizeEnv(diagnoseEnv({ AI_PROVIDER: "mock" }), { production: false, aiProvider: "mock" }).aiConfigured).toBe(true);
  });
});

describe("yapılandırılmış log, ilişkilendirme, metrik, hata kodları", () => {
  it("kırpma: hassas alanlar ve metindeki sır kalıpları", () => {
    const out = redact({ apiKey: "sk-abc", proof: "p", password: "x", transcript: "merhaba", audio: new Uint8Array(3), route: "/t/abcdefghijklmnopqrstuv/asistan", nested: { authorization: "Bearer zzz" }, note: "fail sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA at postgres://u:pw@h/db" }) as Record<string, unknown>; // secret-scan:allow — sahte test değeri
    expect(out.apiKey).toBe(REDACTED);
    expect(out.proof).toBe(REDACTED);
    expect(out.transcript).toBe(REDACTED);
    expect(out.audio).toBe(REDACTED);
    expect(out.route).toBe("/t/<qr>/asistan");
    expect(JSON.stringify(out)).not.toMatch(/sk-proj-A|pw@|zzz/);
    expect(redactText("redis://default:hunter22@cache:6379")).toBe("redis://***"); // secret-scan:allow — sahte test değeri
  });

  it("logger JSON satırı + hata raporlayıcı kancası yalnızca kırpılmış alanları alır", () => {
    const lines: string[] = [];
    const reported: unknown[] = [];
    setLogSink((line) => lines.push(line));
    setErrorReporter((_e, f) => reported.push(f));
    log.error("ai.failed", { requestId: "abc12345", provider: "openai", apiKey: "sk-xxxxxxxxxxxxxxxxxxxxxxxx" }); // secret-scan:allow — sahte test değeri
    setLogSink(null);
    setErrorReporter(null);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: "error", event: "ai.failed", requestId: "abc12345", provider: "openai", apiKey: REDACTED });
    expect(JSON.stringify(reported)).not.toContain("sk-xxx");
  });

  it("ilişkilendirme kimliği: geçerli gelen değer korunur, enjeksiyon reddedilir", () => {
    const id = newCorrelationId();
    expect(isValidCorrelationId(id)).toBe(true);
    expect(correlationIdFrom(new Headers({ "x-request-id": "abcdef12" }))).toBe("abcdef12");
    expect(correlationIdFrom({ get: () => "bad\nvalue injected" })).toMatch(/^[0-9a-f]{24}$/);
    expect(isValidCorrelationId("x".repeat(65))).toBe(false);
  });

  it("metrik anlık görüntüsü ve kararlı hata kodları", () => {
    metrics.resetForTests();
    metrics.inc("orders.submitted");
    metrics.gauge("sse.connections", 2);
    metrics.gauge("sse.connections", -1);
    metrics.observe("order.submit_ms", 120);
    const snap = metrics.snapshot();
    expect(snap.counters["orders.submitted"]).toBe(1);
    expect(snap.gauges["sse.connections"]).toBe(1);
    expect(snap.latency["order.submit_ms"]).toMatchObject({ count: 1, avgMs: 120 });
    expect(ERROR_CODES).toEqual(expect.arrayContaining(["AI_PROVIDER_TIMEOUT", "AI_STT_FAILED", "REALTIME_UNAVAILABLE", "REDIS_UNAVAILABLE", "ORDER_CONFLICT", "TENANT_ACCESS_DENIED"]));
    expect(providerErrorCode("timeout")).toBe("AI_PROVIDER_TIMEOUT");
    expect(providerErrorCode("http_500")).toBe("AI_PROVIDER_ERROR");
  });
});

describe("özellik haritası, sınırlar, gövde, sır taraması", () => {
  it("STARTER / PRO / AI (Sprint 20: tüm paket özellikleri sunucuda uygulanır — bkz. billing testleri)", () => {
    expect(planHasFeature("STARTER", "qr_menu") && planHasFeature("STARTER", "qr_labels") && !planHasFeature("STARTER", "ordering")).toBe(true);
    expect(planHasFeature("PRO", "kds") && planHasFeature("PRO", "service_requests") && !planHasFeature("PRO", "voice_ai")).toBe(true);
    expect(FEATURES.every((f) => planHasFeature("AI", f))).toBe(true);
  });

  it("maliyet sınırları merkezi; istemci yeniden bağlanma ~20 sn'yi kapsar", () => {
    expect(AI_LIMITS.timeouts.liveTurnMs).toBeGreaterThan(AI_LIMITS.timeouts.chatMs);
    expect(AI_LIMITS.maxResponseTokens).toBeLessThanOrEqual(500);
    const total = Array.from({ length: SESSION_LIMITS.reconnectAttempts }, (_, i) => reconnectBackoff(i)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(15_000);
    expect(reconnectBackoff(10)).toBe(SESSION_LIMITS.reconnectMaxDelayMs);
  });

  it("gövde sınırı: Content-Length ile ve uzunluksuz akışta erken ret; bozuk JSON", async () => {
    const big = new Request("http://x/", { method: "POST", headers: { "content-length": String(BODY_LIMITS.smallJson + 1) }, body: "{}" });
    expect(await readJsonBody(big, BODY_LIMITS.smallJson)).toEqual({ ok: false, error: "too_large" });
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024)));
        c.close();
      },
    });
    const chunked = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readJsonBody(chunked, BODY_LIMITS.smallJson)).toEqual({ ok: false, error: "too_large" });
    expect(await readJsonBody(new Request("http://x/", { method: "POST", body: "{bad" }), 100)).toEqual({ ok: false, error: "invalid" });
    expect(await readJsonBody(new Request("http://x/", { method: "POST", body: '{"a":1}' }), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("sır taraması kalıpları bulur, değeri yazdırmaz; muaf işaret çalışır", () => {
    const text = ["const k = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX'", "DATABASE_URL=postgresql://neondb_owner:npg_AbCdEfGh1234@ep-x.neon.tech/db", "QR_TOKEN_SECRET=AbCdEfGhIjKlMnOpQrStUvWxYz012345", "QR_TOKEN_SECRET=", "ok line", "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX // secret-scan:allow"].join("\n");
    const findings = scanText(text, "f.ts") as { line: number; pattern: string }[];
    expect(findings.map((f) => f.pattern)).toEqual(expect.arrayContaining(["openai-key", "postgres-url-with-password", "qr-secret-assignment"]));
    expect(findings.some((f) => f.line === 4 || f.line === 6)).toBe(false);
    expect(JSON.stringify(findings)).not.toContain("npg_");
  });
});
