# Dağıtım (Sprint 21)

Bu belge ilk üretim dağıtımı ve sonraki sürümler içindir. Canlı sunucuda hiçbir şey otomatik değişmez; komutlar örnektir.
İlgili: [migration-baseline.md](migration-baseline.md) · [rollback.md](rollback.md) · [production-checklist.md](production-checklist.md)

## 1. Mimari

```
            İnternet (HTTPS, joker TLS *.masanovai.com + go.masanovai.com + özel alan adları)
                                   │
                              ┌────▼────┐   SSE / NDJSON tamponsuz · /media doğrudan diskten · gövde sınırları
                              │  Nginx  │   X-Request-Id · gzip · HSTS (diğer güvenlik başlıkları uygulamadan)
                              └────┬────┘
                                   │ 127.0.0.1:3000
                       ┌───────────▼────────────┐
                       │ Node 24 · Next 16       │  PM2: tek süreç (önerilen başlangıç) ya da küme (2–4)
                       │ server.mjs (APP_ENV=    │  /api/health · /api/ready
                       │ production)             │
                       └──┬──────┬──────┬───────┘
                          │      │      │
            ┌─────────────▼┐ ┌───▼────┐ ┌▼──────────────────────────┐
            │ Neon Postgres│ │ Redis 7│ │ /var/lib/masanova/uploads │  (yerel disk; yedeklenir)
            │ pooler + dir.│ │ (küme) │ └───────────────────────────┘
            └──────────────┘ └────────┘
                 Dış (isteğe bağlı): OpenAI (AI / ses) · gelecekte ödeme sağlayıcısı (şu an YOK)
```

## 2. Sunucu düzeni

| Yol | İçerik | Sahip / izin |
|---|---|---|
| `/var/www/masanova/releases/<release-id>/` | Her sürüm ayrı klasör (kod + `node_modules` + `.next`) | `masanova:masanova` 0755 |
| `/var/www/masanova/current` | Etkin sürüme sembolik bağlantı (PM2 `cwd`) | — |
| `/etc/masanova/masanova.env` | Ortam değişkenleri (sürümler arası ortak) | `root:masanova` **0640** |
| `/var/lib/masanova/uploads` | `UPLOAD_ROOT` — yüklenen görseller (dağıtımdan BAĞIMSIZ) | `masanova:www-data` dizin **2750**, dosya 0640 |
| `/var/log/masanova` | PM2 günlükleri | `masanova:masanova` 0750 |
| `/var/backups/masanova` | Yükleme yedekleri (sunucu dışına da kopyalanır) | `root:root` 0700 |

- Uygulama kullanıcısı `masanova` yüklemeleri okur / yazar; Nginx (`www-data`) grubu yalnızca **okur** (`/media` sunumu). 777 YOK.
  `setgid` (2750) yeni dosyaların grubunu `www-data` tutar; `umask 027` önerilir.
- Hiçbir dağıtım adımı `UPLOAD_ROOT`'u silmez / taşımaz: kod `releases/` altında, yüklemeler `/var/lib` altında.
  Uygulama, `UPLOAD_ROOT` uygulama klasörünün içindeyse açılmaz (`src/server/media/storage/root.ts`).

## 3. Ortam değişkenleri

Sınıflandırma `.env.example` başında; tanılama `npm run env:check`, tam denetim `npm run deploy:check`.

| Sınıf | Değişkenler |
|---|---|
| CORE_REQUIRED (yoksa açılmaz) | `DATABASE_URL`, `DIRECT_URL`, `QR_TOKEN_SECRET` (≥ 32), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ROOT_DOMAIN` |
| PRODUCTION_REQUIRED | `APP_ENV=production`, `UPLOAD_ROOT` (mutlak, yazılabilir), `QR_ENTRY_ORIGIN`, `REDIS_URL` (çok süreçte), `NEXT_MANUAL_SIG_HANDLE=true` |
| FEATURE_OPTIONAL | `AI_*`, `VOICE_*`, `PAYMENT_*`, `REDIS_NAMESPACE`, `UPLOAD_PUBLIC_BASE_URL`, `LOG_LEVEL`, `RELEASE_ID` / `GIT_SHA`, `PM2_INSTANCES` |
| PUBLIC (derlemeye gömülür) | `NEXT_PUBLIC_*` — değişirse YENİDEN DERLEME gerekir |
| SECRET | bağlantı dizeleri, `QR_TOKEN_SECRET`, `*_API_KEY`, `PAYMENT_WEBHOOK_SECRET`, `SEED_*_PASSWORD` |
| TEST_ONLY | `SEED_*`, `CONTACT_VERIFICATION_*`, `"mock"` sağlayıcı değerleri, `PRODUCTION_DB_HOSTS` |

**Profil:** `NODE_ENV` standart kalır. Dağıtım ortamı `APP_ENV` (development / test / staging / production). Üretimde
`"mock"` AI / ses / ödeme / doğrulama sağlayıcıları **yok sayılır** (özellik kapalı + açılış uyarısı); `/odeme/mock/*` 404.
Staging / demo: `APP_ENV=staging` (mock izinli, açılış denetimleri uyarı düzeyinde).

**Açılış denetimleri** (`src/lib/startup-checks.ts`, `APP_ENV=production`): eksik / kısa `QR_TOKEN_SECRET`, geçersiz kök alan,
eksik / göreli / yazılamayan `UPLOAD_ROOT`, **küme + Redis yok** → süreç BAŞLAMAZ. Mock sağlayıcı, gerçek AI / ödeme
yokluğu, `QR_ENTRY_ORIGIN` eksikliği → uyarı, özellik kapalı.

## 4. Alan adları ve QR

| Ad | Örnek | Not |
|---|---|---|
| Kök (platform + pazarlama + panel) | `masanova.corvis.tech` | `NEXT_PUBLIC_APP_URL=https://masanova.corvis.tech` |
| Kiracı alt alanları | `*.masanova.corvis.tech` (ör. `idilwaffle.masanova.corvis.tech`) | `NEXT_PUBLIC_ROOT_DOMAIN=masanova.corvis.tech`; joker DNS `*.masanova` + joker TLS (aşağıya bakın) |
| QR giriş | `go.masanova.corvis.tech` | `QR_ENTRY_ORIGIN=https://go.masanova.corvis.tech` |
| Özel alan adları | `menu.restoran.com` | Super Admin › Alan adları; DNS doğrulaması; ayrı sertifika |

**Üretim alan adı (karar: 2026-10-21): `masanova.corvis.tech`.** Firma alt alan adı = Super Admin sihirbazındaki kısa ad
(`idilwaffle` → `idilwaffle.masanova.corvis.tech`). Kodda sabit alan adı yoktur; her şey bu iki değişkenden türetilir
(`tests/unit/tenant-url-corvis.test.ts`, `tests/unit/host.test.ts` bu yapıyı doğrular).

`corvis.tech` DNS bölgesinde gereken kayıtlar (sunucu IP'si `<IP>`):

| Kayıt | Tür | Değer |
|---|---|---|
| `masanova` | A / AAAA | `<IP>` |
| `*.masanova` | A / AAAA | `<IP>` (tüm firmalar + `www` + `go`) |

> ### ⚠ İki seviyeli joker sertifika
> `*.masanova.corvis.tech` İKİNCİ seviye jokerdir. Cloudflare'in ücretsiz Universal SSL sertifikası yalnızca `corvis.tech` ve
> `*.corvis.tech`'i kapsar; `idilwaffle.masanova.corvis.tech` için **çalışmaz** (tarayıcı sertifika hatası verir). Seçenekler:
> 1. **Cloudflare proxy açık (turuncu bulut):** Advanced Certificate Manager ile `*.masanova.corvis.tech` sertifikası (ücretli).
> 2. **Proxy kapalı (gri bulut):** sertifikayı sunucu üretir — Caddy / Traefik / certbot ile Let's Encrypt joker sertifikası,
>    DNS-01 doğrulaması (Cloudflare API token, yalnızca `corvis.tech` bölgesinde DNS düzenleme yetkisi).
> 3. **Vercel:** joker alan adı Vercel'de ancak ad sunucuları Vercel'deyse desteklenir; `corvis.tech` başka yerdeyse 1 ya da 2.
> Yeni firma açılınca DNS / sertifika için ek iş gerekmez (joker kayıt hepsini kapsar).

> ### ⚠ QR_ENTRY_ORIGIN etiketler basıldıktan sonra ASLA değiştirilmez
> Basılı her QR `<QR_ENTRY_ORIGIN>/q/<token>` kodlar. Değişirse sahadaki tüm etiketler çalışmaz. İlk etiket basılmadan önce
> kesinleştirin (önerilen ayrı, kalıcı alt alan: `go.masanova.corvis.tech`). `QR_TOKEN_SECRET` de değiştirilmemelidir (etiketler
> çalışmaya devam eder ama yeniden indirilemez).

## 5. Yedekleme

**Veritabanı (Neon):** Neon dal / anlık geri yükleme (PITR) — plan saklama süresini doğrulayın. Her migration'dan ÖNCE:
Neon konsolu / CLI ile **adlı dal** oluşturun (`backup-<tarih>-<release>`) ve oluştuğunu doğrulayın. İsteğe bağlı mantıksal
yedek: `pg_dump --format=custom "$DIRECT_URL" > masanova-<tarih>.dump` (sunucu dışında, şifreli saklayın).
**Yedek "var" sayılmadan önce geri yüklemesi bir test dalında denenmiş olmalı.** (Sprint 21 itibarıyla üretim yedeği
henüz OLUŞTURULMADI / doğrulanmadı.)

**Yüklenen görseller (`UPLOAD_ROOT`) — veritabanı yedeği bunları İÇERMEZ:**

```bash
# günlük, artımlı (sunucu dışına): rsync -a --delete OLMADAN (yanlış silme yayılmasın)
rsync -a /var/lib/masanova/uploads/ backup-host:/srv/backups/masanova/uploads/
# anlık arşiv (dağıtım öncesi)
tar -C /var/lib/masanova -czf /var/backups/masanova/uploads-$(date +%F).tar.gz uploads
```

Geri yükleme: arşivi `UPLOAD_ROOT`'a açın, sahiplik / izinleri §2'ye göre düzeltin. Veritabanı ve görsel yedeği aynı
zaman noktasından olmalıdır (aksi halde kayıtta olan görsel diskte olmayabilir — sayfa görselsiz çalışır, kırılmaz).
Yetim dosyalar: `npm run media:cleanup` (önce `--dry-run`).

## 6. Dağıtım prosedürü

```bash
# 0) Yerel / CI: npm run release:verify  (checkpoint + tam regresyon + üretim yapılandırma denetimi)
REL=$(date +%Y%m%d%H%M)-$(git rev-parse --short=12 HEAD)
# 1) Ön denetim (yeni sürüm klasöründe, canlı uygulamaya dokunmadan)
git clone --depth 1 --branch <tag> <repo> /var/www/masanova/releases/$REL && cd $_
ln -s /etc/masanova/masanova.env .env
npm ci                                   # postinstall: prisma generate; sharp hedef mimaride derlenir
GIT_SHA=$(git rev-parse HEAD) npm run deploy:check -- --production
npm run db:baseline:check                # FRESH / PENDING / IN_SYNC beklenir; AMBIGUOUS → DUR
# 2) Geri yükleme noktası: Neon dalı + uploads arşivi (§5) — DOĞRULAYIN
# 3) Migration (yalnızca PENDING / FRESH ise)
npm run db:deploy
# 4) Derleme — canlı sürüm çalışmaya devam eder
NODE_ENV=production npm run build
# 5) Atomik geçiş
ln -sfn /var/www/masanova/releases/$REL /var/www/masanova/current
RELEASE_ID=$REL pm2 reload deploy/ecosystem.config.cjs --only masanova --update-env
# 6) Doğrulama
curl -fsS https://masanovai.com/api/ready && npm run smoke -- --base https://masanovai.com --qr <test-masa-QR> --expect-release $REL
# 7) Sorun → docs/rollback.md
```

- **Derleme canlı klasör dışında**: yeni sürüm kendi klasöründe kurulur ve derlenir; derleme başarısızsa canlı sürüme
  dokunulmamıştır. Geçiş tek sembolik bağlantı değişimi + `pm2 reload` (küme kipinde sıfır kesinti; tek süreçte birkaç
  saniyelik yeniden başlatma — `kill_timeout` içinde SSE / canlı ses düzgün kapanır).
- Migration'lar ileri uyumlu yazılmalıdır (eski kod yeni şemayla çalışabilmeli) — geri alma bu varsayıma dayanır.
- Son 3 sürüm klasörü saklanır; eskiler silinir (yüklemeler etkilenmez).

## 7. PM2 ve veritabanı bağlantıları

`deploy/ecosystem.config.cjs`: `masanova` (fork, 1) ya da `masanova-cluster` (`PM2_INSTANCES`, varsayılan 2).

- **Başlatıcı `server.mjs`'dir, `next start -H 127.0.0.1` KULLANMAYIN.** Next 16.4'te `-H 127.0.0.1` ile proxy rewrite'ı
  (kiracı alt alan adı → `/site`) dış adres sayılır; nginx `X-Forwarded-Proto: https` gönderdiğinde Next kendi düz HTTP
  portuna TLS ile bağlanmaya çalışır → `Failed to proxy https://localhost:<port>/site … EPROTO` → kiracı sayfaları 500
  ([next.js#94745](https://github.com/vercel/next.js/issues/94745)). `server.mjs` soketi yalnızca `BIND_HOST`'a
  (varsayılan `127.0.0.1`) bağlar, Next'e iç ad olarak `localhost` verir. Ortam: `PORT` nginx upstream portuyla aynı
  olmalı (ör. `127.0.0.1:5022` → `PORT=5022`). Doğrulama: `node tests/e2e/e2e-proxy-host.cjs` (salt okunur).

- **Küme > 1 ise `REDIS_URL` zorunlu** — yoksa uygulama üretimde açılmaz (gerçek zamanlı olaylar ve hız sınırları süreçler
  arası paylaşılmaz).
- **Bağlantı hesabı:** toplam ≈ süreç × `connection_limit` (`DATABASE_URL`'de, örn. 5) + migration / betikler. Neon pooler
  (PgBouncer) çok sayıda istemci bağlantısını kabul eder ama uç nokta işlem havuzu sınırlıdır; **`instances: "max"`
  KULLANMAYIN**. Başlangıç: tek süreç; yük artınca 2–4 süreç + Redis.
- Bellek sınırı `max_memory_restart: 768M`.

## 8. Nginx

`deploy/nginx.conf.example`: TLS + HSTS, gzip, `X-Request-Id`, SSE ve canlı ses için `proxy_buffering off` + uzun okuma süresi,
`/api/v1/media` için 16 MB gövde (diğer her yer 5 MB), `/media/` doğrudan `UPLOAD_ROOT`'tan (desen kısıtlı, immutable,
`nosniff`, sandbox CSP), `/api/health` ve `/api/ready` günlüksüz. Diğer güvenlik başlıkları (CSP, frame, referrer)
uygulamadan gelir — Nginx'te tekrarlanmaz.

## 9. Sağlık ve hazırlık

| Uç | Anlam | Kod |
|---|---|---|
| `/api/health` | `ok` / `degraded` (Redis yapılandırılmış ama yok) / `down` (veritabanı yok); veritabanı, Redis, gerçek zamanlı sağlayıcı, AI yapılandırılmış mı, depolama yazılabilir mi, profil, kısa sürüm kimliği, uyarı ADLARI | 200 / 503 |
| `/api/ready` | Çekirdek: veritabanı + (yapılandırılmışsa) Redis + yazılabilir depolama. AI / ödeme kesintisi restoranı "hazır değil" yapmaz | 200 / 503 |

Sır, host, bağlantı dizesi, anahtar döndürülmez.

## 10. Günlükler ve hata raporlama

- Uygulama günlükleri JSON satırı, `redact()` süzgecinden geçer (anahtar, token, QR yolu, e-posta / telefon, konuşma metni,
  kart / ödeme imzası, bağlantı dizesi gizlenir). Hata raporlayıcı kancası (`setErrorReporter`) yalnızca SÜZÜLMÜŞ alanları alır.
- Döndürme: `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 50M && pm2 set pm2-logrotate:retain 14 && pm2 set pm2-logrotate:compress true`
  (ya da `/var/log/masanova/*.log` için logrotate `copytruncate`). Nginx erişim günlükleri sistem logrotate'i ile.

## 11. Zamanlanmış işler

| İş | Komut | Bugün | Öneri |
|---|---|---|---|
| AI konuşma saklama süresi | `npm run ai:retention` | elle | günlük cron (tek sunucuda) |
| Yetim medya temizliği | `npm run media:cleanup` | elle | haftalık (önce `--dry-run`) |
| Süresi dolan ödeme rezervasyonları | — | **istek tetiklemeli** (bir sonraki ödeme isteğinde serbest kalır) | gerekmez; isteğe bağlı ileride |
| İletişim doğrulama kodu temizliği | — | süre denetimi istek anında; kayıt kalır | ileride cron |
| Abonelik normalleştirme | `normalizeExpired()` (servis) | isteğe bağlı — yetki zaten zamandan türetilir | ileride cron |

**Cron kuralı:** zamanlanmış iş PM2 küme süreçlerinin içinde ÇALIŞMAZ (her süreç aynı temizliği yapar). Tek bir sistem
cron'u / ayrı tek süreç kullanın: `cd /var/www/masanova/current && npm run ai:retention`.

## 12. İlk üretim özellik durumu

| Özellik | Başlangıç |
|---|---|
| QR menü | AÇIK (her paket) |
| Sipariş, KDS, servis, rezervasyon, CRM, sadakat, kampanya, analitik | PAKETE göre (Super Admin aboneliği) |
| Sesli AI / Danışman AI açıklaması | KAPALI — gerçek OpenAI duman testi geçene kadar `AI_PROVIDER` boş |
| Online ödeme | KAPALI — gerçek ödeme sağlayıcısı yok (`PAYMENT_PROVIDER` boş) |
| İletişim doğrulaması (SMS / e-posta) | KAPALI — sağlayıcı yok |

## 13. Platform varsayımları

- Node **24.x** (`.nvmrc`, `engines`), npm 11 (`packageManager`). `npm ci` (lockfile ile tekrarlanabilir).
- `sharp` yerel ikilisi `npm ci` sırasında hedef platform için iner: Linux x64 / arm64 glibc (Ubuntu 22.04+ / Debian 12).
  Alpine (musl) farklı ikili ister — `npm ci` hedef makinede çalıştırılmalı, `node_modules` başka işletim sisteminden kopyalanmaz.
  Doğrulama: `npm run deploy:check` sharp ile küçük bir görsel üretir.
- `public/worklets/capture-processor.js` (canlı ses yakalama) ve pazarlama OG / Twitter görselleri derleme çıktısındadır
  (Sprint 21 temiz kurulum kuru denemesinde doğrulandı).
- Üretim seed'i YOK: geliştirme seed'i (demo kiracı + demo hesaplar) `APP_ENV=production`'da reddedilir. İlk yönetici
  `BOOTSTRAP_ADMIN_EMAIL=… npm run bootstrap:admin` (tek seferlik; parola üretilir, bir kez gösterilir).
