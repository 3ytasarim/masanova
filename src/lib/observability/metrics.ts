/**
 * Süreç içi metrikler (sayaç + gösterge + basit gecikme özeti). Kişisel veri YOK — yalnızca sayılar ve sabit adlar.
 * Çok süreçte her süreç kendi değerini tutar (/api/admin/metrics süreç kimliğiyle döner); kalıcı / birleşik metrik için
 * bu modül ileride OpenTelemetry dışa aktarıcısına bağlanabilir (ad ve etiketler değişmez).
 */
export type MetricName =
  | "http.requests"
  | "orders.submitted"
  | "payments.succeeded"
  | "payments.provider_failure"
  | "payments.reservation_expired"
  | "payments.webhook_duplicate"
  | "payments.webhook_invalid_signature"
  | "orders.idempotent_replay"
  | "service_requests.created"
  | "sse.connections"
  | "sse.opened"
  | "sse.closed"
  | "realtime.published"
  | "realtime.delivered"
  | "realtime.publish_failed"
  | "realtime.reconnects"
  | "redis.errors"
  | "ratelimit.limited"
  | "ratelimit.fallback"
  | "ai.turns"
  | "ai.failures"
  | "ai.timeouts"
  | "voice.live_turns"
  | "voice.realtime_sessions"
  | "voice.fallback_turns"
  | "voice.reconnects"
  | "ssrf.blocked"
  | "shutdown.signals"
  | "analytics.cache_hit"
  | "analytics.cache_miss"
  | "analytics.errors"
  | "analytics.slow_queries"
  | "analytics.exports"
  | "media.uploaded"
  | "media.upload_rejected"
  | "media.served"
  | "advisor.generated"
  | "advisor.cache_hit"
  | "advisor.explained"
  | "advisor.explanation_reused"
  | "advisor.explanation_rejected"
  | "advisor.provider_failure"
  | "advisor.fallback";

type Summary = { count: number; sum: number; max: number; buckets: number[] };
const BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

type Store = { counters: Map<string, number>; gauges: Map<string, number>; latency: Map<string, Summary>; startedAt: number };
const KEY = Symbol.for("masanova.metrics");
function store(): Store {
  const g = globalThis as typeof globalThis & { [KEY]?: Store };
  g[KEY] ??= { counters: new Map(), gauges: new Map(), latency: new Map(), startedAt: Date.now() };
  return g[KEY];
}

const label = (name: string, tag?: string) => (tag ? `${name}{${tag}}` : name);

export const metrics = {
  inc(name: MetricName, by = 1, tag?: string) {
    const s = store();
    const k = label(name, tag);
    s.counters.set(k, (s.counters.get(k) ?? 0) + by);
  },
  gauge(name: MetricName, delta: number) {
    const s = store();
    s.gauges.set(name, Math.max(0, (s.gauges.get(name) ?? 0) + delta));
  },
  observe(name: string, ms: number) {
    const s = store();
    const sum = s.latency.get(name) ?? { count: 0, sum: 0, max: 0, buckets: BUCKETS.map(() => 0) };
    sum.count += 1;
    sum.sum += ms;
    sum.max = Math.max(sum.max, ms);
    BUCKETS.forEach((b, i) => {
      if (ms <= b) sum.buckets[i]! += 1;
    });
    s.latency.set(name, sum);
  },
  snapshot() {
    const s = store();
    return {
      uptimeSeconds: Math.round((Date.now() - s.startedAt) / 1000),
      counters: Object.fromEntries(s.counters),
      gauges: Object.fromEntries(s.gauges),
      latency: Object.fromEntries(
        [...s.latency].map(([k, v]) => [k, { count: v.count, avgMs: v.count ? Math.round(v.sum / v.count) : 0, maxMs: Math.round(v.max), le: Object.fromEntries(BUCKETS.map((b, i) => [b, v.buckets[i]])) }]),
      ),
    };
  },
  /** Yalnızca testler. */
  resetForTests() {
    const s = store();
    s.counters.clear();
    s.gauges.clear();
    s.latency.clear();
  },
};
