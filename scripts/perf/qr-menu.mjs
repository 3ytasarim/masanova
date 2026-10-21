#!/usr/bin/env node
/**
 * QR menü üretim performans denetimi (yerel `next start`, varsayılan :3820). Ölçer:
 *   ilk HTML boyutu ve süresi, aktarılan JS (sıkıştırılmış), görsel tembel yükleme, istemci paketinde sunucu kodu
 *   (Redis / gözlemlenebilirlik / veritabanı / AI anahtarı adı) bulunmaması, AI'sız restoranda asistan kodu
 *   indirilmemesi. Veritabanında yalnızca demo kiracının paketini GEÇİCİ değiştirir ve geri alır.
 *   npm run perf:qr
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("dotenv").config({ quiet: true });
const puppeteer = require("puppeteer-core");
const { PrismaClient } = require("@prisma/client");
require("../../tests/e2e/lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA

const BASE = "http://localhost:3820";
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true, plan: true } });
const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: demo.id, name: "Masa 12" }, select: { id: true } });
const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
const token = crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + row.tokenNonce, "utf8").digest().subarray(0, 16).toString("base64url");
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

async function measure(plan) {
  await db.tenant.update({ where: { id: demo.id }, data: { plan } });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const sizes = new Map();
  const types = new Map();
  cdp.on("Network.responseReceived", (e) => types.set(e.requestId, { url: e.response.url, type: e.type }));
  cdp.on("Network.loadingFinished", (e) => sizes.set(e.requestId, e.encodedDataLength));
  const started = Date.now();
  await page.goto(`${BASE}/q/${token}`, { waitUntil: "networkidle2" });
  const loadMs = Date.now() - started;
  let js = 0;
  let html = 0;
  const jsUrls = [];
  for (const [id, info] of types) {
    const size = sizes.get(id) ?? 0;
    if (info.type === "Script") {
      js += size;
      jsUrls.push(info.url);
    }
    if (info.type === "Document") html += size;
  }
  const images = await page.$$eval("img", (imgs) => ({ total: imgs.length, lazy: imgs.filter((i) => i.loading === "lazy").length }));
  let serverCode = [];
  for (const url of jsUrls) {
    const text = await (await fetch(url.replace(/\/\/[a-z0-9-]+\.localhost:/i, "//localhost:"))).text();
    for (const marker of ["ioredis", "masanova.metrics", "masanova.redis", "PrismaClient", "AI_API_KEY", "api.openai.com", "setErrorReporter"]) if (text.includes(marker)) serverCode.push(marker);
  }
  const hasAiButton = !!(await page.$('[data-testid="ai-button"]'));
  await page.close();
  return { plan, loadMs, htmlKb: Math.round(html / 1024), jsKb: Math.round(js / 1024), jsFiles: jsUrls.length, images, serverCodeInBundle: [...new Set(serverCode)], hasAiButton };
}

const hadSettings = await db.aiSettings.findUnique({ where: { tenantId: demo.id } });
await db.aiSettings.upsert({ where: { tenantId: demo.id }, create: { tenantId: demo.id, enabled: true }, update: { enabled: true } });
try {
  const starter = await measure("STARTER");
  const ai = await measure("AI");
  console.log(JSON.stringify(starter));
  console.log(JSON.stringify(ai));
  console.log(JSON.stringify({ aiButtonOnlyWithPlan: !starter.hasAiButton && ai.hasAiButton, jsDeltaKbWithAiPlan: ai.jsKb - starter.jsKb }));
} finally {
  await db.tenant.update({ where: { id: demo.id }, data: { plan: demo.plan } });
  if (hadSettings) await db.aiSettings.update({ where: { tenantId: demo.id }, data: { enabled: hadSettings.enabled } });
  else await db.aiSettings.delete({ where: { tenantId: demo.id } });
  await browser.close();
  await db.$disconnect();
}
