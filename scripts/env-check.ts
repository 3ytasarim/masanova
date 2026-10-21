/**
 * Açılış öncesi ortam tanılaması: npm run env:check
 * Yalnızca değişken ADI, sınıfı ve durumu yazılır — değer, uzunluk ya da önek ASLA.
 * Çıkış kodu: çekirdek değişken eksik / geçersizse 1.
 */
import "dotenv/config";
import { diagnoseEnv, summarizeEnv } from "../src/lib/env-diagnostics";
import { resolveAppEnv } from "../src/lib/runtime-profile";

const production = process.argv.includes("--production") || resolveAppEnv() === "production";
const rows = diagnoseEnv(process.env);
const summary = summarizeEnv(rows, { production, aiProvider: process.env.AI_PROVIDER });
for (const r of rows) console.log(`${r.status === "ok" ? "✓" : r.status === "missing" ? "·" : "✗"} ${r.name.padEnd(26)} ${r.class.padEnd(11)} ${r.status}`);
console.log(`\nçekirdek: ${summary.coreOk ? "tamam" : "EKSİK"} · AI: ${summary.aiConfigured ? "yapılandırılmış" : "kapalı"} · Redis: ${summary.redisConfigured ? "var" : "yok (tek süreç)"}`);
for (const w of summary.warnings) console.log(`uyarı: ${w}`);
process.exitCode = summary.coreOk ? 0 : 1;
