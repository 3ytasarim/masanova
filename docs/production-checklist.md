# MasaNova AI — Üretim Kontrol Listesi

> Bu belge yayın öncesi ve sonrası doğrulama içindir. Örnek yapılandırmalar: `deploy/ecosystem.config.cjs` (PM2),
> `deploy/nginx.conf.example` (Nginx). Gerçek sunucuya otomatik hiçbir şey uygulanmaz.

## 1. DNS

- [ ] `masanovai.com` ve `www` → sunucu (A / AAAA).
- [ ] `*.masanovai.com` joker kayıt → aynı sunucu (kiracı alt alanları).
- [ ] `go.masanovai.com` → aynı sunucu (`QR_ENTRY_ORIGIN`; basılı QR'ların kalıcı adresi).
- [ ] Özel alan adları: kiracı panelindeki doğrulama (TXT) adımları tamamlanmadan yayına alınmaz.

## 2. Ortam değişkenleri

Tanılama: `npm run env:check -- --production` (yalnızca ad + durum yazar; değer asla).

| Sınıf | Değişkenler | Eksikse |
| --- | --- | --- |
| core (zorunlu) | `DATABASE_URL`, `DIRECT_URL`, `QR_TOKEN_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ROOT_DOMAIN` | Süreç açılmaz (anlaşılır hata, değer yazılmaz) |
| production | `QR_ENTRY_ORIGIN`, `UPLOAD_ROOT` | Uyarı; basılı QR'lar uygulama origin'ine bağlanır / görseller geliştirme klasörüne (`./storage/uploads`) yazılır |
| ai | `AI_PROVIDER`, `AI_API_KEY`, `VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER` | Yalnızca sesli AI kullanılamaz; menü / sipariş / mutfak çalışır |
| redis | `REDIS_URL` | Tek süreçte doğru; **PM2 küme / çok sunucuda zorunlu** |
| optional | `AI_MODEL`, `VOICE_*_MODEL`, `VOICE_*_API_KEY`, `VOICE_TTS_VOICE_*`, `VOICE_REALTIME`, `REDIS_NAMESPACE`, `LOG_LEVEL`, `NEXT_MANUAL_SIG_HANDLE` | Varsayılanlar |

- [ ] `NEXT_PUBLIC_*` değerleri **derleme anında** gömülür: üretim değerleriyle derleyin.
- [ ] `AI_PROVIDER=mock` üretimde KULLANILMAZ.
- [ ] Hatalı AI / Redis değeri platformu durdurmaz; `/api/health` → `configWarnings` (yalnızca ad) içinde görünür.
- [ ] Sır taraması temiz: `npm run secrets:scan` (bulgu yalnızca dosya:satır + kalıp adı; değer yazdırılmaz).

## 3. Neon (PostgreSQL)

- [ ] `DATABASE_URL` = **pooled** bağlantı (`-pooler` host, `pgbouncer=true`, düşük `connection_limit`, ör. 5). Süreç
      sayısı × `connection_limit` Neon havuz sınırını aşmamalı (küme kipinde süreç başına havuz açılır).
- [ ] `DIRECT_URL` = doğrudan bağlantı — yalnızca `npm run db:deploy` (migration) ve betikler. Pooler'da migration
      çalıştırmayın (çok komutlu işlem sorunları).
- [ ] Prisma istemcisi süreç başına tekil (globalThis); geliştirme hot-reload'u yeni havuz açmaz.
- [ ] Zaman aşımları: sağlık kontrolü sorgusu 3 sn; etkileşimli işlemler Prisma varsayılanı (5 sn) — sipariş / mutfak
      işlemleri kısa ve satır kilidi kullanır; genel, agresif bir sorgu zaman aşımı **eklenmedi** (bilinçli).
- [ ] Yedekleme: Neon PITR / dal (branch) — saklama süresini plana göre ayarlayın; aylık geri yükleme provası.
- [ ] **Veritabanı yedeği yüklenen görselleri İÇERMEZ.** `UPLOAD_ROOT` ayrıca yedeklenmeli (bkz. §16).

## 4. Redis

- [ ] Standart Redis **≥ 7.0** (hız sınırı `PEXPIRE … NX` kullanır). Yönetilen hizmet (Upstash, ElastiCache…) ya da
      kendi sunucunuz; uygulama satıcıya bağlı değil (`ioredis`, standart protokol).
- [ ] TLS: `rediss://`. Parola URL'de — loglanmaz (log kırpma `redis://***`).
- [ ] `REDIS_NAMESPACE` ortam başına farklı (prod / staging aynı Redis'i paylaşırsa karışmaz).
- [ ] Redis kullanımı: gerçek zamanlı olay yolu (Pub/Sub, `mn:<ns>:rt:<kanal>`) + hız sınırı sayaçları
      (`mn:<ns>:rl:<politika>:<sha256(özne)>` — IP / e-posta ham yazılmaz). **Redis yetki ya da bütünlük kaynağı
      DEĞİLDİR**: sipariş tekilliği, servis talebi mükerrer koruması, AI tur tekilliği veritabanı kısıtlarıdır.
- [ ] Redis erişilemezse (bkz. §8) platform çalışır; `/api/health` → `status: "degraded"`, `redis: "disconnected"`.

## 5. OpenAI (sesli AI)

- [ ] `AI_PROVIDER=openai`, `VOICE_STT_PROVIDER=openai`, `VOICE_TTS_PROVIDER=openai`, `AI_API_KEY` (yalnızca sunucu).
- [ ] Gerçek sağlayıcı duman testi (ücretli, az istek): `AI_SMOKE=1 npm run test:ai-smoke` — 5 dil TTS → STT,
      güven puanı, akan yanıt, araya girme (iptal), güvenli menü aracı, değiştirmeyen eylem kartı, geçersiz model hatası.
- [ ] Maliyet / takılma sınırları (`src/lib/ai/limits.ts`, işletme ayarı DEĞİŞTİREMEZ): STT 20 sn, sohbet 20 sn,
      TTS 20 sn, canlı tur 60 sn (aşılınca yukarı akış isteği iptal edilir), ifade ≤ 45 sn / 3 MB, konuşma başına ≤ 60
      tur, yanıt ≤ 350 token, seslendirme ≤ 900 karakter, canlı oturum 45 sn hareketsizlik / 10 dk üst sınır.
- [ ] Anahtar istemci paketinde yok (tarayıcı testi 18a + `npm run perf:qr` doğrular).

## 6. PM2

- [ ] Tek süreç: `pm2 start deploy/ecosystem.config.cjs --only masanova`.
- [ ] Küme: `pm2 start deploy/ecosystem.config.cjs --only masanova-cluster` — **`REDIS_URL` zorunlu**. Olmazsa A
      sürecindeki sipariş B sürecine bağlı mutfak ekranına gitmez; hız sınırları süreç başına sayılır.
- [ ] Yapışkan oturum gerekmez (SSE ve canlı ses hangi sürece düşerse düşsün; olaylar Redis'ten, durum veritabanında).
- [ ] `NEXT_MANUAL_SIG_HANDLE=true` + `kill_timeout ≥ 10000`: SIGTERM'de sıra — yeni uzun bağlantı reddi (503) →
      açık SSE akışları kapanır (istemciler yeniden bağlanır) → devam eden canlı ses turları iptal edilip "yarıda kaldı"
      işaretlenir (yeni süreç aynı turu hemen sahiplenir) → Redis abonelikleri / bağlantıları → Prisma; toplam ≤ 8 sn.
- [ ] Deploy sırasında: canlı ses yeniden bağlanır (≈ 20 sn'ye kadar üstel bekleme, aynı tur anahtarı) ya da bas-konuşa
      düşer; yinelenen tur / sipariş / servis talebi oluşmaz (veritabanı tekilliği).

## 7. Nginx

`deploy/nginx.conf.example`:

- [ ] `proxy_set_header Host $host` (kiracı çözümlemesi Host'a dayanır), `X-Forwarded-For`, `X-Forwarded-Proto`.
- [ ] SSE (`/panel/olaylar`, `/t/<token>/akis`, `/t/<token>/siparis/<id>/akis`): `proxy_buffering off`,
      `proxy_read_timeout ≥ 3700s` (heartbeat 25 sn; bağlantı saatte bir yenilenir). Uygulama ayrıca
      `X-Accel-Buffering: no` gönderir.
- [ ] Canlı ses (`/t/<token>/asistan/canli`, NDJSON): `proxy_buffering off`, `proxy_read_timeout 90s`.
- [ ] `client_max_body_size 5m` (en büyük meşru gövde ≈ 4,2 MB base64 ses; uygulama rota başına daha küçük sınırı akış
      sırasında uygular, büyük gövde erken reddedilir). İSTİSNA: `location = /api/v1/media` → `16m` (görsel yükleme,
      kapak 15 MB). Bu blok yoksa 5 MB üstü yüklemeler Nginx'te 413 alır.
- [ ] `/media/` (yüklenen görseller): örnekteki `alias` bloğu ile Nginx doğrudan diskten sunabilir (önerilen); kök
      `UPLOAD_ROOT` ile aynı olmalı. Blok yoksa uygulama sunar (aynı başlıklar).
- [ ] Varsayılan `proxy_read_timeout 60s` (normal sayfa / eylem takılmaz). Arka uç yeniden başlarken 502/503/504 →
      canlı ses istemcisi bunu geçici sayar ve aynı turla yeniden dener.

## 8. Hız sınırı yedek davranışı (Redis yapılandırılmış ama erişilemiyor)

Politikalar: `src/server/rate-limit/policies.ts`. Sınır hiçbir durumda sessizce kaldırılmaz.

| Politika | Redis yokken | Gerekçe |
| --- | --- | --- |
| `ai.*` (oturum, tur, masa, IP, ses) | **ret** (asistan "şu an yanıt veremiyor") | Ücretli sağlayıcı; sınırsız çağrı riski yok |
| `ai.report` | süreç içi bellek | Ücretsiz, yalnızca ölçüm |
| `order.*`, `service.*` | süreç içi bellek | Sipariş / servis akışı durmamalı; bütünlük veritabanında |
| `qr.entry` | süreç içi bellek | Menü görüntüleme her koşulda çalışmalı |
| `auth.login`, `demo.*` | süreç içi bellek | Giriş mümkün kalır; süreç başına sınır yine uygulanır |

Redis hiç yapılandırılmamışsa (tek süreç) tüm politikalar süreç içi bellektir. Yedeğe düşüş `ratelimit.fallback`
metriği ve 30 sn'de bir `RATE_LIMIT_FALLBACK` uyarı logu üretir.

## 9. HTTPS ve güvenlik başlıkları

- [ ] Let's Encrypt (joker sertifika DNS-01 ile), otomatik yenileme.
- [ ] HSTS (üretimde uygulama gönderir), CSP (`script-src 'self' 'unsafe-inline'`; worklet ve uzak betik yok),
      `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`,
      `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(self), …`.
      Mikrofon yalnızca aynı origin'de ve kullanıcının açık dokunuşuyla; AudioWorklet modülü aynı origin'den.

## 10. Sağlık kontrolü

`GET /api/health` → `{ status, database, databaseLatencyMs, redis, realtime, aiConfigured, configWarnings }`

- 200 `ok` · 200 `degraded` (Redis yapılandırılmış ama yok) · 503 `down` (veritabanı yok — trafiği kesin).
- Sır, host, iç URL, sürüm, hata mesajı içermez. Uptime izleme 30–60 sn aralıkla.
- Süreç metrikleri: `GET /api/admin/metrics` (yalnızca Super Admin oturumu; destek modunda kapalı): sayaçlar
  (sipariş, servis talebi, SSE, gerçek zamanlı yayın / teslim / yeniden bağlanma, hız sınırı, AI tur / hata / zaman
  aşımı, sesli yedek), gecikme özetleri, bellek. Kişisel veri yok; değerler süreç başınadır (`pid`).

## 11. Loglama ve gözlemlenebilirlik

- [ ] Loglar satır başına JSON (stdout / stderr): `ts, level, event, pid, requestId, route, durationMs, status, code`
      (+ AI: `provider, model, latencyMs, category`; gerçek zamanlı: `provider, reconnects`).
- [ ] Kırpılan alanlar: API anahtarı, QR tokenı (`/t/<qr>`), konuşma kanıtı, oturum, parola, ham ses, konuşma metni,
      bağlantı dizesi. `LOG_LEVEL=info` (üretim).
- [ ] `x-request-id`: proxy her isteğe ekler, yanıtta döner (destek kaydıyla eşleştirme; sır taşımaz).
- [ ] Kararlı hata kodları: `src/lib/observability/errors.ts` (ör. `AI_PROVIDER_TIMEOUT`, `REDIS_UNAVAILABLE`,
      `ORDER_CONFLICT`, `SSRF_BLOCKED`). Herkese açık yanıtta yığın izi yok.
- [ ] Sentry / OpenTelemetry: `setErrorReporter()` kancası (satıcıdan bağımsız; yalnızca kırpılmış alanlar) —
      `src/instrumentation.ts` içinde bağlanır. Bu sürümde harici hesap gerekmez.

## 12. Önbellek

- Public menü önbelleği kiracı + şube + dil anahtarlıdır (`unstable_cache`, etiket `public-menu:<tenantId>`), 300 sn
  üst süre. Panel ve servis değişiklikleri önbelleği **anında** geçersiz kılar.
- **Doğrudan SQL düzenlemesi** uygulamanın geçersiz kılmasını ATLAR → en fazla 5 dk eski menü. Çözüm: Super Admin ›
  İşletme › "Menü önbelleğini temizle" (denetim kaydı `TENANT_MENU_CACHE_INVALIDATED`). Herkese açık uç nokta YOK.
- Redis önbelleği bu sürümde eklenmedi (zorunlu olacak kadar fayda görülmedi). Next veri önbelleği varsayılan olarak
  yerel dosya sistemindedir (`.next/cache`); etiket geçersiz kılmasının PM2 küme süreçleri / birden çok SUNUCU
  arasında anında yayılması bu sprintte DOĞRULANMADI. En kötü durumda diğer örnekler değişikliği ≤ 300 sn içinde
  görür. Anında yayılım gerekiyorsa sonraki adım paylaşılan önbellek işleyicisidir (Next `cacheHandler`, anahtarlar
  kiracı + şube + dil — kiracı çakışması olmaz).

## 13. Veri saklama

| Veri | Saklama | Not |
| --- | --- | --- |
| Siparişler, sipariş geçmişi, mutfak fişleri | Süresiz (iş kaydı) | Otomatik silme YOK — yasal saklama süresi işletme / muhasebe kararı |
| Servis talepleri | Süresiz | Otomatik silme YOK |
| AI konuşmaları (mesaj + tur) | Konuşma ≤ 6 sa sonra müşteriye kapanır | İsteğe bağlı temizlik: `npm run ai:retention -- --days 30 [--dry-run]` (toplu, sınırlı) |
| AI kullanım kayıtları (`AiUsage`) | Süresiz | İçerik yok; faturalama / ölçüm — temizlik işi SİLMEZ |
| Ham ses | **Saklanmaz** | Bellekte STT'ye gider ve atılır |
| Denetim kayıtları | Süresiz | Parola / token / kanıt / konuşma metni içermez (otomatik test) |

AI konuşma gizliliği: konuşma metinleri yalnızca işletmenin kendi kiracısında, tarayıcıya özel kanıtla erişilir;
temizlik işi önerilen 30 gün sonra çalıştırılmalı (KVKK aydınlatma metninde belirtilmeli).

## 14. Ticari özellik kapıları

Sprint 20 itibarıyla TÜM paket özellikleri sunucuda uygulanıyor (bkz. §22). Harita: `src/config/plans.ts`; karar:
`src/server/billing/entitlements.ts` (`checkFeature` / `requireFeature`). Geçiş: mevcut işletmeler migration ile mevcut
paketlerinde süresiz ACTIVE aboneliğe alındı — STARTER olanlar artık sipariş / servis alamaz; yayından önce paketleri doğrulayın.

## 15. Analitik ve veritabanı güvenliği (Sprint 12)

- [ ] Sprint 12 indeks migration'ı uygulandı (`20261018000000_sprint12_analytics_indexes`). Not: geliştirme
      veritabanında `_prisma_migrations` tablosu yok (`migrate deploy` → P3005). Üretimde ilk kurulumda baseline
      (`prisma migrate resolve --applied …`) yapılmalı, ardından `npm run db:deploy` çalıştırılmalı.
- [ ] `npm run db:diff` çıktısı boş (şema kayması yok).
- [ ] Shadow veritabanı GEREKİRSE ayrı ve boş bir Neon dalı kullanılır (`SHADOW_DATABASE_URL`), asla ana veritabanı.
      Kilit (`prisma/guard.ts`) bunu engeller; `MASANOVA_ALLOW_DB_RESET` üretim ortamında TANIMLANMAZ.
- [ ] Üretim Neon projesinde point-in-time restore penceresi etkin ve yeterli (≥ 7 gün).
- [ ] Analitik büyük kiracıda yavaşlarsa `ANALYZE` çalıştırılır (bayat istatistik) ve `analytics.slow_queries` izlenir.
- [ ] Bilinen sınırlar ürün ekibiyle paylaşıldı:
  - Tek para birimi.
  - Kategoriler güncel görünümle gösterilir.
  - QR taramaları yalnızca toplam olarak tutulur.
  - Dönüşüm, tükendi ve AI→sipariş ilişkisi yok.

## 16. Yüklenen görseller (Sprint 13)

Önerilen yerleşim:

```
/var/www/masanova            uygulama (her dağıtımda yenilenir — yüklemeler BURADA DEĞİL)
/var/lib/masanova/uploads    UPLOAD_ROOT (kalıcı; dağıtım / derleme silmez)
  tenants/<kiracı-anahtarı>/{logo,hero,categories,products}/<varlık-id>/<çıktı>.webp|png
```

- [ ] `UPLOAD_ROOT=/var/lib/masanova/uploads` (mutlak yol). Uygulama klasörünün içi (`src/`, `public/`, `.next/`) reddedilir.
- [ ] Klasör sahibi uygulama kullanıcısı (PM2), izin `750`; Nginx doğrudan sunacaksa Nginx kullanıcısına okuma izni.
- [ ] PM2 küme kipi tek sunucuda sorunsuz (aynı disk). **Birden çok SUNUCUDA** yerel disk paylaşılmaz → nesne depolamaya
      geçin (aşağıda) ya da ortak dosya sistemi kullanın.
- [ ] **YEDEK (kritik):** veritabanı yedeği görselleri içermez. `UPLOAD_ROOT` günlük yedeklenmeli (ör. `restic` /
      `rsync` → Hetzner Storage Box) ve geri yükleme provası yapılmalı. Geri yüklemede veritabanı ve görsel yedeği aynı
      zamana yakın olmalı (yoksa görselsiz kayıt / kayıtsız dosya). Kayıtsız dosyalar `npm run media:cleanup` ile temizlenir.
- [ ] Yetim temizliği (haftalık cron): `npm run media:cleanup -- --min-age-minutes 60` (önce `--dry-run`). Referanslı
      görsele asla dokunmaz; yalnızca sayıları yazar.
- [ ] `UPLOAD_PUBLIC_BASE_URL` boş → `/media` (uygulama ya da Nginx). CDN kullanılırsa https adresi; CSP `img-src https:` zaten izinli.
- [ ] Nesne depolamaya geçiş (Hetzner Object Storage / S3 / R2): `S3ImageStorageProvider` aynı arayüzü uygular
      (`src/server/media/storage/types.ts`); veritabanı yalnızca `storageProvider` + `storageKey` tutar, mutlak yol
      tutmaz. Geçiş: dosyaları aynı anahtarlarla kovaya kopyala → kayıtların `storage_provider` değerini güncelle →
      `UPLOAD_PUBLIC_BASE_URL` CDN adresi. Karışık dönem desteklenir (her kayıt kendi sağlayıcısıyla çözülür).
- [ ] SVG logo bu sürümde kabul edilmez (güvenli temizleme garanti edilemiyor); PNG / WebP / JPEG.

## 17. İşletme Danışmanı (Sprint 15)

- [ ] Migration `20261115000000_sprint15_business_advisor` uygulandı (`advisor_insights`, `AiUsageKind.ADVISOR`).
- [ ] Danışman salt okunurdur; AI açıklaması gerçek sağlayıcıyla (AI_PROVIDER=openai) ilk kez açılmadan önce birkaç
      içgörü elle kontrol edilmeli (doğrulayıcı uydurma rakam / kâr / personel / nedensellik içeren metni reddeder).
- [ ] `advisor.refresh` hız sınırı (kiracı başına 6 / saat) ve `ADVISOR` kullanım kayıtları maliyet takibine dahil.
- [ ] Bilinen sınır: karşılaştırma önceki eşdeğer dönemdir; hafta içi / hafta sonu ve tatil mevsimselliği modellenmez.

## 18. Müşteri verisi, onay ve sadakat (Sprint 16)

- [ ] `CONTACT_VERIFICATION_PROVIDER` BOŞ (gerçek sağlayıcı eklenene kadar). `mock` üretimde yok sayılır ama yine de
      ayarlamayın; `CONTACT_VERIFICATION_MOCK_CODE` üretimde tanımlı olmamalı.
- [ ] Onay metinleri (`src/config/consent.ts`) hukuk incelemesinden geçti; metin değişirse `CONSENT_VERSION` artırıldı.
      Aydınlatma metni restoranın kendi gizlilik politikasına bağlanmalı. Uygulama KVKK / GDPR uyumu İDDİA ETMEZ.
- [ ] Neon: disk şifrelemesi + TLS (`sslmode=require`); veritabanı erişimi en az yetkiyle. Telefon / e-posta uygulama
      düzeyinde şifrelenmez — ileride zarf şifreleme + HMAC arama sütunları (`docs/architecture.md` §130).
- [ ] Veritabanı yedekleri müşteri kişisel verisi içerir: erişim ve saklama süresi buna göre.
- [ ] Silme talepleri (`/panel/musteriler` → "Silme talebi" rozeti) düzenli izlenir; anonimleştirme iş akışı henüz
      yok — talep elle ele alınır, sipariş / muhasebe kayıtları silinmez.
- [ ] Sadakat varsayılan KAPALI; işletme kuralı belirleyip açar. Puan kazandıktan sonra iptal edilen sipariş için
      otomatik geri alma yok (manuel düzeltme).
- [ ] Kampanya / SMS / e-posta / WhatsApp gönderimi YOK; pazarlama onayı yalnızca kayıt altındadır. Gelecekte gönderim
      eklenirse doğrulanmış iletişim + çift onay şart.

## 19. Rezervasyonlar (Sprint 17)

- [ ] Veritabanında `btree_gist` uzantısı ve `reservation_tables_no_overlap` EXCLUDE kısıtı mevcut (migration
      `20261215000000_sprint17_reservations`). Neon'da uzantı desteklenir; başka sağlayıcıda önce doğrulayın.
- [ ] Şube saat dilimleri doğru (`branches.timezone`); rezervasyon saatleri şube saatiyle seçilir, UTC saklanır.
- [ ] Rezervasyon açılmadan önce: şube açılış saatleri, masa kapasiteleri ve (gerekirse) masa birleşimleri girildi.
      Kapasitesi boş masa rezervasyona atanmaz.
- [ ] Public rota `/rezervasyon` kiracı alan adında; Nginx tarafında ek kural gerekmez (proxy → /site).
- [ ] Hız sınırları çok süreçte Redis ile paylaşılır (`REDIS_URL`); yoksa süreç başına bellek.
- [ ] SMS / e-posta hatırlatma YOK: `RESERVATION_CONFIRMED` / `RESERVATION_REMINDER` olayları yalnızca loglanır.
- [ ] Depozito / kart garantisi / online ödeme YOK (ileride).
- [ ] Saklama: rezervasyon geçmişi otomatik silinmez; kişisel alanların anonimleştirme politikası işletmeyle belirlenmeli.
- [ ] Gece yarısını geçen açılış saati desteklenmez (en geç 24:00).

## 20. Kuponlar, ödüller, kampanyalar (Sprint 18)

- [ ] Migration'lar SIRAYLA: `20261220000000_sprint18_promotions` ardından `20261220000100_sprint18_ledger_reversal`
      (REVERSAL enum değeri ayrı işlemde eklenmeli).
- [ ] `orders_discount_check` (toplam = ara toplam − indirim) mevcut; sipariş yazan başka bir araç / içe aktarma bu kurala uymalı.
- [ ] Kupon tahmin denemesine karşı hız sınırı çok süreçte Redis ile paylaşılır (`REDIS_URL`).
- [ ] Kampanya gönderimi YOK. Sağlayıcı eklenirken: doğrulanmış iletişim + güncel izin + abonelikten çıkma (onay geri alma) şart;
      Sprint 16 doğrulama sağlayıcısıyla birleştirilmez.
- [ ] İşletmeye açıklayın: "Sipariş Tutarı" net tutardır; brüt / indirim ayrı gösterilir. ROI hesaplanmaz.
- [ ] Kişi başı kupon sınırı yalnızca kayıtlı müşteride uygulanır.

## 21. Online ödemeler (Sprint 19)

- [ ] Migration `20261225000000_sprint19_payments` uygulandı; tetikleyiciler (`payments_guard`, `payment_allocations_guard`,
      `payment_refunds_guard`) mevcut. Ödeme / dağılım satırına doğrudan yazan araç bu kurallara uymalı.
- [ ] **Gerçek sağlayıcı yok.** `PAYMENT_PROVIDER=mock` gerçek para ÇEKMEZ; canlıda boş bırakın ya da onaylı bir
      sağlayıcı adaptörü eklenene kadar online ödemeyi kapalı tutun. Seçilecek sağlayıcı için: hukuki / PCI onayı,
      barındırılan ödeme sayfası (kart verisi sunucuya hiç gelmez), webhook imza şeması, idempotency, iade API'si.
- [ ] `PAYMENT_WEBHOOK_SECRET` gerçek sağlayıcıda ZORUNLU ve sağlayıcı panelindekiyle aynı; `PAYMENT_API_KEY` yalnızca sunucuda.
      Tarayıcıya en fazla `PAYMENT_PUBLIC_KEY` gidebilir.
- [ ] Webhook adresi platform alan adında: `https://<platform>/api/v1/payments/webhook/<sağlayıcı>`; ters vekil gövdeyi
      değiştirmemeli (imza ham gövde üzerinden), 64 KB sınırı. IP hız sınırı UYGULANMAZ (imza esastır).
- [ ] Ödeme hız sınırları (sipariş / IP) çok süreçte Redis ile paylaşılır (`REDIS_URL`).
- [ ] "İade gerekli" işaretli ödemeleri (geç onay, bakiye dolu) düzenli kontrol edin; sağlayıcı panelinden iade edin.
- [ ] İşletmeye açıklayın: iade bakiyeyi yeniden açmaz, sadakat puanını / kuponu değiştirmez; analitikteki ödeme tutarları
      muhasebe / "kesinleşmiş ciro" değildir (komisyon, valör, ters ibraz yok).
- [ ] Sesli / metin AI asistanında ödeme aracı YOK (test: `tests/unit/payments.test.ts`).

## 22. Abonelik ve paket yetkileri (Sprint 20)

- [ ] Migration `20261230000000_sprint20_subscriptions` uygulandı: mevcut her işletme mevcut paketinde ACTIVE, süresiz
      manuel aboneliğe geri dolduruldu (erişim değişmez). Yayından sonra Super Admin her işletmenin dönem / deneme tarihini girmeli.
- [ ] `tenants.plan` artık aynadır (tetikleyici); paketi değiştiren araç / betik `subscriptions` tablosunu (ya da Super Admin) kullanmalı.
- [ ] Demo / iç işletmeler: abonelik "Faturasız (iç)" + süresiz (slug'a göre özel durum YOK).
- [ ] Paket özellikleri sunucuda uygulanıyor: STARTER işletmeler sipariş / servis / rezervasyon / CRM / ödeme ALAMAZ.
      Yayından önce mevcut müşterilerin doğru pakette olduğunu doğrulayın (aksi halde yetkiler düşer — veri silinmez).
- [ ] Limit değerleri GEÇİCİDİR (`LIMITS_PROVISIONAL`); ticari karar verilince `src/config/plans.ts` güncellenmeli, pazarlamada gösterilmez.
- [ ] Deneme / ek süre bitişi cron gerektirmez (her kontrolde zamandan türetilir). İsteğe bağlı bakım: `normalizeExpired()`.
- [ ] Faturalama sağlayıcısı (Stripe / iyzico …) eklenirken yalnızca abonelik servisini çağırmalı; yetkilendirme değişmez.
- [ ] Bildirim YOK: deneme bitiyor / ek süre e-postası gönderilmez (uyarı yalnızca sahip panelinde).

## 23. İlk üretim kontrol noktası (Sprint 21)

Ayrıntı: [deployment.md](deployment.md) · [migration-baseline.md](migration-baseline.md) · [rollback.md](rollback.md) ·
[baseline-sprint20.md](baseline-sprint20.md)

- [ ] `npm run release:verify` yeşil (sır taraması, hijyen, lint, typecheck, birim, Neon entegrasyon, derleme, S1–S20,
      üretim yapılandırma denetimi).
- [ ] `APP_ENV=production`; `UPLOAD_ROOT=/var/lib/masanova/uploads` (mutlak, yazılabilir, uygulama klasörü dışında).
- [ ] **`QR_ENTRY_ORIGIN` kesinleşti (ör. `https://go.masanovai.com`) — ilk etiket basıldıktan sonra DEĞİŞTİRİLMEZ.**
- [ ] `npm run deploy:check -- --production` → çekirdek hata 0.
- [ ] `npm run db:baseline:check` → `FRESH` (yeni DB) ya da `BASELINE_NEEDED` (Durum B) — belirsizse DUR.
- [ ] Neon geri yükleme dalı oluşturuldu ve doğrulandı; `UPLOAD_ROOT` yedeği alındı (veritabanı yedeği görselleri içermez).
- [ ] İlk yönetici: `BOOTSTRAP_ADMIN_EMAIL=… npm run bootstrap:admin`; geliştirme seed'i ÇALIŞTIRILMADI.
- [ ] PM2 tek süreç ile başlandı; küme gerekirse önce gerçek Redis (`npm run redis:smoke` → DOĞRULANDI).
- [ ] `AI_PROVIDER` boş (gerçek OpenAI duman testi `AI_SMOKE=1 npm run test:ai-smoke` geçene kadar).
- [ ] `PAYMENT_PROVIDER` boş (gerçek ödeme sağlayıcısı yok; `mock` üretimde zaten yok sayılır).
- [ ] Dağıtım sonrası: `npm run smoke -- --base https://… --qr <test-masa-QR> --expect-release <id>` → tümü ✓.
- [ ] Zamanlanmış işler tek cron'dan (PM2 süreçlerinde değil): `ai:retention` günlük, `media:cleanup` haftalık.
- [ ] Günlük döndürme (pm2-logrotate) kuruldu.
- [ ] `PRODUCTION_DB_HOSTS` geliştirici makinelerinde ayarlı (testler üretim DB'sine karşı çalışmaz).

## 24. Duman testleri (yayından sonra)

- [ ] `/api/health` 200 `ok`, `realtime: "redis"` (küme), `aiConfigured: true`.
- [ ] QR etiketi tara → menü → sepete ekle → sipariş gönder → panel listesi ve mutfak ekranı **yenilemeden** günceller.
- [ ] Garson çağır → servis panosu yenilemeden günceller.
- [ ] `/panel/analitik` (sahip): bugünün siparişleri KPI'larda görünüyor, CSV indiriliyor; garson hesabıyla 404.
- [ ] Panel › AI › İşletme Danışmanı açılır (AI paketli işletme); garson hesabıyla 404.
- [ ] Panel › Ürün › Görseller: 1600×1200 JPEG yükle → QR menüde hemen görünür; sunucu yeniden başlatıldıktan sonra görsel hâlâ var (kalıcı klasör).
- [ ] (AI paketli test işletmesi) Sesli asistan: soru, söz kesme, sepet kartı.
- [ ] `AI_SMOKE=1 npm run test:ai-smoke` (gerçek sağlayıcı, ücretli, birkaç istek).
- [ ] Yerel kalite kapısı: `npm run lint && npm run typecheck && npm test && npm run build`,
      `npm run test:integration`, `npm run test:regression` (yalıtılmış tarayıcı paketleri, ~30 dk).
- [ ] Yük temeli (yerel, üretime karşı ÇALIŞMAZ): `npm run load:test`, `npm run load:db`, `npm run perf:qr`.
