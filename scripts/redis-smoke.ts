/**
 * Gerçek Redis duman testi (Sprint 21): npm run redis:smoke
 *
 * Üretim güvenli: YALNIZCA kendi ad alanındaki geçici anahtarlar (masanova-smoke:<rastgele>:*), kısa TTL, sonunda DEL.
 * FLUSHDB / FLUSHALL / KEYS * ASLA. REDIS_URL yoksa "DOĞRULANMADI" yazar ve 2 ile çıkar (başarı sayılmaz).
 * Denetimler: PING · sürüm ≥ 7 · SET/GET · Pub/Sub · atomik hız sınırı ilkeli (MULTI INCR + PEXPIRE NX) · temizlik.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import Redis from "ioredis";

async function main() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("REDIS: DOĞRULANMADI — REDIS_URL ayarlı değil (gerçek Redis ile hiç sınanmadı).");
    process.exit(2);
  }
  const ns = `masanova-smoke:${randomBytes(4).toString("hex")}`;
  const opts = { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1, enableOfflineQueue: false } as const;
  const a = new Redis(url, opts);
  const sub = new Redis(url, opts);
  a.on("error", () => undefined);
  sub.on("error", () => undefined);
  const results: [string, boolean][] = [];
  try {
    await a.connect();
    await sub.connect();
    results.push(["PING", (await a.ping()) === "PONG"]);
    const info = await a.info("server");
    const major = Number(/redis_version:(\d+)/.exec(info)?.[1] ?? 0);
    results.push([`sürüm ≥ 7 (bulunan ${major})`, major >= 7]);
    await a.set(`${ns}:kv`, "ok", "PX", 30_000);
    results.push(["SET/GET (ad alanlı, TTL)", (await a.get(`${ns}:kv`)) === "ok"]);
    const channel = `${ns}:ch`;
    const got = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 3000);
      sub.on("message", (c, m) => {
        if (c === channel && m === "hello") {
          clearTimeout(t);
          resolve(true);
        }
      });
    });
    await sub.subscribe(channel);
    await a.publish(channel, "hello");
    results.push(["Pub/Sub", await got]);
    const key = `${ns}:rl`;
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await a.multi().incr(key).pexpire(key, 10_000, "NX").exec();
      counts.push(Number(r?.[0]?.[1] ?? 0));
    }
    const ttl = await a.pttl(key);
    results.push(["atomik hız sınırı (INCR + PEXPIRE NX)", counts.join(",") === "1,2,3" && ttl > 0 && ttl <= 10_000]);
  } catch (e) {
    results.push([`bağlantı / komut hatası (${e instanceof Error ? e.name : "hata"})`, false]);
  } finally {
    await a.del(`${ns}:kv`, `${ns}:rl`).catch(() => 0);
    a.disconnect();
    sub.disconnect();
  }
  for (const [name, ok] of results) console.log(`${ok ? "✓" : "✗"} ${name}`);
  const ok = results.every(([, v]) => v);
  console.log(ok ? "REDIS: DOĞRULANDI" : "REDIS: BAŞARISIZ");
  process.exit(ok ? 0 : 1);
}

void main();
