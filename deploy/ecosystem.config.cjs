/**
 * PM2 örnek yapılandırması — ÖRNEKTİR, gerçek sunucuya otomatik uygulanmaz (bkz. docs/deployment.md › PM2).
 *
 *   Tek süreç (önerilen başlangıç):  pm2 start deploy/ecosystem.config.cjs --only masanova
 *   Küme                         :  REDIS_URL=… PM2_INSTANCES=2 pm2 start deploy/ecosystem.config.cjs --only masanova-cluster
 *
 * Küme kipinde REDIS_URL ZORUNLU: yoksa uygulama APP_ENV=production'da AÇILMAZ (src/lib/startup-checks.ts) — aksi halde
 * sipariş → mutfak ekranı olayları yalnızca aynı süreçteki bağlantılara gider, hız sınırları süreç başına sayılır.
 * Yapışkan oturum (sticky session) GEREKMEZ.
 *
 * Süreç sayısı: "max" KULLANMAYIN. Her süreç kendi Prisma havuzunu açar (Neon pooler + connection_limit). Önerilen
 * PM2_INSTANCES = 2–4; toplam bağlantı ≈ süreç × connection_limit (DATABASE_URL'de, örn. 5) Neon planının sınırının
 * altında kalmalı. Ayrıntı: docs/deployment.md › Veritabanı bağlantıları.
 *
 * cwd: "current" sembolik bağlantısı (sürüm klasörü yaklaşımı — docs/deployment.md › Atomik geçiş).
 */
// Bağımlılık yok (PM2 doğrudan yükler): yollar düz birleştirme.
const APP_DIR = process.env.MASANOVA_APP_DIR || __dirname + "/..";
const LOG_DIR = process.env.MASANOVA_LOG_DIR || "/var/log/masanova";

const shared = {
  cwd: APP_DIR,
  // server.mjs: soket yalnızca BIND_HOST'a (127.0.0.1), Next'e iç ad "localhost" — `next start -H 127.0.0.1` kiracı
  // rewrite'ını dış proxy sanıp EPROTO / 500 üretir (Next issue #94745; ayrıntı server.mjs başında).
  script: "server.mjs",
  // Sinyali uygulama yönetir: SSE → canlı ses turları → Redis → Prisma kapanır, sonra çıkış.
  kill_timeout: 10000,
  listen_timeout: 20000,
  max_memory_restart: "768M",
  // Günlükler: JSON satırları; döndürme pm2-logrotate ile (docs/deployment.md › Günlükler).
  out_file: LOG_DIR + "/app.out.log",
  error_file: LOG_DIR + "/app.err.log",
  merge_logs: true,
  time: false,
  env: {
    NODE_ENV: "production",
    APP_ENV: "production",
    NEXT_MANUAL_SIG_HANDLE: "true",
    // nginx upstream'iyle aynı olmalı (ör. 127.0.0.1:5022 → PORT=5022).
    PORT: process.env.PORT || "3000",
    BIND_HOST: process.env.BIND_HOST || "127.0.0.1",
  },
};

const clusterInstances = Number(process.env.PM2_INSTANCES || 2);

module.exports = {
  apps: [
    { ...shared, name: "masanova", instances: 1, exec_mode: "fork" },
    { ...shared, name: "masanova-cluster", instances: clusterInstances, exec_mode: "cluster" },
  ],
};
