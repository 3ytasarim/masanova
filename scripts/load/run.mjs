#!/usr/bin/env node
/**
 * Hafif YEREL yük testi — çalışan bir sunucuya (varsayılan http://localhost:3820, `next start`):
 *   npm run load:test [-- --base http://localhost:3820 --sse 200 --requests 300 --concurrency 20]
 *
 *  1. Public QR menü okuması (HTML) — gecikme p50 / p95, hata, yük boyutu
 *  2. /api/health
 *  3. SSE: N eşzamanlı masa akışı aç → sunucu belleği (RSS) → hepsini kapat → bellek / temizlik
 *  4. (REDIS_URL varsa) olay yayını: Redis'e tek mesaj → N SSE istemcisine teslim süresi
 * ÜRETİME KARŞI ÇALIŞMAZ: hedef yalnızca localhost / 127.0.0.1 olabilir. Veritabanını DEĞİŞTİRMEZ (yalnızca okur).
 */
import http from "node:http";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("dotenv").config({ quiet: true });
require("../../tests/e2e/lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const BASE = new URL(arg("base", "http://localhost:3820"));
if (!["localhost", "127.0.0.1"].includes(BASE.hostname)) {
  console.error("Yük testi yalnızca yerel sunucuya karşı çalışır (localhost / 127.0.0.1).");
  process.exit(2);
}
const SSE_COUNT = Number(arg("sse", "200"));
const REQUESTS = Number(arg("requests", "300"));
const CONCURRENCY = Number(arg("concurrency", "20"));
const PORT = Number(BASE.port || 80);

function get(path, host, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const req = http.request({ host: BASE.hostname, port: PORT, path, method: "GET", headers: { host, "x-forwarded-for": "198.51.100.10" } }, (res) => {
      let bytes = 0;
      res.on("data", (c) => (bytes += c.length));
      res.on("end", () => resolve({ status: res.statusCode, ms: performance.now() - started, bytes }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ status: 0, ms: performance.now() - started, bytes: 0 }));
    req.end();
  });
}

async function burst(label, total, concurrency, fn) {
  const results = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < total) {
        next += 1;
        results.push(await fn());
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => Math.round(ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))]);
  const errors = results.filter((r) => r.status !== 200).length;
  const out = { label, requests: total, concurrency, rps: Math.round(total / elapsed), p50: pct(50), p95: pct(95), max: Math.round(ms.at(-1)), errors, avgBytes: Math.round(results.reduce((s, r) => s + r.bytes, 0) / results.length) };
  console.log(JSON.stringify(out));
  return out;
}

function serverRssMb() {
  try {
    if (process.platform === "win32") {
      const line = execSync("netstat -ano", { encoding: "utf8" }).split(/\r?\n/).find((l) => new RegExp(`[:.]${PORT}\\s.*LISTENING`).test(l));
      const pid = line?.trim().split(/\s+/).pop();
      const csv = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8" });
      return Math.round(Number(csv.split('","')[4]?.replace(/[^\d]/g, "")) / 1024);
    }
    const pid = execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { encoding: "utf8" }).trim().split(/\s+/)[0];
    return Math.round(Number(execSync(`ps -o rss= -p ${pid}`, { encoding: "utf8" }).trim()) / 1024);
  } catch {
    return null;
  }
}

function openSse(path, host) {
  return new Promise((resolve) => {
    const req = http.request({ host: BASE.hostname, port: PORT, path, method: "GET", headers: { host, accept: "text/event-stream" } }, (res) => {
      const conn = { res, req, events: 0, connected: false, firstEventAt: null };
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (chunk.includes(": connected")) conn.connected = true;
        if (chunk.includes("event: ")) {
          conn.events += 1;
          conn.firstEventAt ??= performance.now();
        }
      });
      res.on("error", () => undefined);
      setTimeout(() => resolve(conn), 50);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
try {
  const demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: demo.id, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const token = crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + row.tokenNonce, "utf8").digest().subarray(0, 16).toString("base64url");
  const tenantHost = `demo.localhost:${PORT}`;

  console.log(`hedef ${BASE.origin} · sunucu RSS başlangıç ${serverRssMb()} MB`);
  await get(`/t/${token}`, tenantHost); // ısınma
  await burst("qr-menu-html", REQUESTS, CONCURRENCY, () => get(`/t/${token}`, tenantHost));
  await burst("health", REQUESTS, CONCURRENCY, () => get("/api/health", BASE.host));

  // SSE
  const before = serverRssMb();
  const conns = (await Promise.all(Array.from({ length: SSE_COUNT }, () => openSse(`/t/${token}/akis`, tenantHost)))).filter(Boolean);
  await new Promise((r) => setTimeout(r, 1500));
  const open = conns.filter((c) => c.connected).length;
  const during = serverRssMb();
  let fanout = null;
  if (process.env.REDIS_URL) {
    const Redis = require("ioredis");
    const ns = (process.env.REDIS_NAMESPACE || "default").toLowerCase();
    const pub = new Redis(process.env.REDIS_URL);
    const started = performance.now();
    const event = { version: 1, occurredAt: new Date().toISOString(), type: "SERVICE_REQUEST_CREATED", data: { kind: "WATER", status: "OPEN" } };
    const receivers = await pub.publish(`mn:${ns}:rt:table:${table.id}`, JSON.stringify(event));
    await new Promise((r) => setTimeout(r, 1500));
    const got = conns.filter((c) => c.events > 0);
    const lat = got.map((c) => c.firstEventAt - started).sort((a, b) => a - b);
    fanout = { redisSubscribers: receivers, delivered: got.length, p50: Math.round(lat[Math.floor(lat.length / 2)] ?? 0), max: Math.round(lat.at(-1) ?? 0) };
    pub.disconnect();
  }
  for (const c of conns) c.req.destroy();
  await new Promise((r) => setTimeout(r, 3000));
  const after = serverRssMb();
  // Sunucu tarafı temizlik kanıtı: tüm akışlar kapandıktan sonra süreç Redis kanalından ÇIKMIŞ olmalı (0 abone).
  let subscribersAfterClose = null;
  if (process.env.REDIS_URL) {
    const Redis = require("ioredis");
    const ns = (process.env.REDIS_NAMESPACE || "default").toLowerCase();
    const pub = new Redis(process.env.REDIS_URL);
    subscribersAfterClose = await pub.publish(`mn:${ns}:rt:table:${table.id}`, "{}");
    pub.disconnect();
  }
  console.log(JSON.stringify({ label: "sse", requested: SSE_COUNT, connected: open, rssBeforeMb: before, rssWithConnectionsMb: during, rssAfterCloseMb: after, perConnectionKb: before && during ? Math.round(((during - before) * 1024) / Math.max(1, open)) : null, fanout, subscribersAfterClose }));
  // Kapandıktan sonra yeni bağlantılar hâlâ açılabiliyor mu (dinleyici / kaynak sızıntısı yok)?
  const probe = await openSse(`/t/${token}/akis`, tenantHost);
  await new Promise((r) => setTimeout(r, 500));
  console.log(JSON.stringify({ label: "sse-after-close-probe", connected: !!probe?.connected }));
  probe?.req.destroy();
} finally {
  await db.$disconnect();
}
