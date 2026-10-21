# MasaNova AI

> **Menünüz değil, masanız akıllansın.**
> AI destekli, çok kiracılı (multi-tenant) restoran, kafe ve otel platformu — 3Y Tasarım & Yazılım Hizmetleri.

Bu depo **Sprint 0 (temel)**, **Sprint 1 (çok kiracılı çekirdek)** ve **Sprint 2 (Super Admin, restoran onboarding, alan adı yönetimi, demo talepleri)** kapsamını içerir: proje iskeleti,
veri modeli, alan adı tabanlı kiracı çözümleme, kiracı veri izolasyonu, oturum + rol altyapısı, denetim kaydı,
tasarım sistemi, landing, Super Admin ve restoran paneli kabukları. Mimari ayrıntılar: [`docs/architecture.md`](docs/architecture.md).

## Teknoloji

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Prisma 6 · Neon PostgreSQL ·
Zod 4 · argon2id · Vitest. UI kütüphanesi yok — kendi primitifleri (`src/components/ui`), ikonlar `lucide-react`.

> **Prisma 6'ya sabitlendi:** Prisma 7+ `datasource.directUrl` desteğini kaldırıp driver adapter zorunlu kılıyor;
> Neon pooled + direct bağlantı ayrımı için 6.x bilinçli tercih. Generator klasik `prisma-client-js`.

## Kurulum

Gereksinim: Node.js ≥ 20.9 (geliştirme 24.x ile yapıldı).

```bash
npm install
cp .env.example .env          # değerleri doldurun (aşağıya bakın)
npx prisma generate
npm run db:deploy             # migration'ları uygular (boş veritabanı)
npx prisma db seed            # demo kiracı + kullanıcılar
npm run dev
```

## Restoran menüsü (Sprint 3)

| Rota | İşlev |
|---|---|
| `/panel/menu` | Menü özeti: kategori/ürün/aktif/tükenen, görseli ve çevirisi eksik ürünler, son güncellenenler |
| `/panel/menu/kategoriler` | Tek seviye iç içe kategoriler; oluştur/düzenle, aktif/öne çıkan, yukarı/aşağı sıralama, çeviriler |
| `/panel/menu/urunler` | Arama (ad, kısa ad, SKU, çeviri), kategori/durum/tükendi/öne çıkan/eksik filtreleri, sıralama, sayfalama, toplu işlemler (silme yok) |
| `/panel/menu/urunler/yeni` | Hızlı ürün oluşturma → editör |
| `/panel/menu/urunler/[id]` | Sekmeler: Genel · Fiyatlandırma · Varyasyonlar · Ekstralar · İçerik & Alerjen · Görseller · Çeviriler · Şubeler |
| `/panel/menu/ekstralar` | Yeniden kullanılabilir ekstra grupları ve seçenekleri (zorunlu/en az/en fazla kuralları) |
| `/panel/menu/kutuphane` | 14 standart alerjen, diyet etiketleri (platform) + işletmeye özel kayıtlar, malzemeler |
| `/panel/masalar` | Şube seçimi, bölgeler (oluştur/düzenle/sırala/pasifleştir), bölgelere göre masalar, tek / toplu masa oluşturma, arama ve filtreler |
| `/panel/masalar/[id]` | Masa düzenleme (ad, numara, kod, bölge, kapasite, aktif) · QR durumu, public adres, okutma, önizleme, SVG/PNG indirme, yenileme / iptal (onaylı), QR geçmişi |
| `/panel/masalar/etiketler` | Etiket tasarımcısı (5 şablon, ön ayarlı + özel boyut, taşma payı, canlı önizleme) · tek etiket PDF/SVG · A4 toplu sayfa PDF |
| `/panel/tema` | QR menü görünümü: düzen (Kompakt / Görsel / Lüks), marka renkleri, logo, kapak görseli, karşılama metni, görünürlük ayarları + canlı telefon önizlemesi (yalnızca işletme sahibi) |
| `<QR_ENTRY_ORIGIN>/q/<token>` | **Kararlı QR girişi** — basılı etiketlerin kodladığı adres; token doğrulanır, kiracının o anki alan adına 307 ile yönlendirilir |
| `/t/<token>` (kiracı alan adı) | Müşteri QR menüsü + sepet: varyant / ekstra seçimi, adet, ürün ve sipariş notu, canlı fiyat önizlemesi, sepet kontrolü, onay ve gönderim (TR/EN/DE/AR + RTL) |
| `/t/<token>/siparis/<id>` | Müşteri sipariş durumu — yalnızca AYNI masanın QR bağlamından, son 24 saat |
| `/panel/siparisler` | Sipariş listesi: şube / durum / bölge / masa / tarih filtreleri, sipariş no araması, sayfalama |
| `/panel/siparisler/[id]` | Sipariş ayrıntısı (değişmez kopyalar), durum geçmişi, kabul / ret (orders.manage) |

Para tamsayı kuruştur; fiyat ve erişilebilirlik tek merkezden çözülür (`src/lib/menu/`). Ayrıntılar:
[`docs/architecture.md`](docs/architecture.md) §18–§27.

## Siparişler, mutfak ekranı ve canlı durum (Sprint 6–7)

- QR masadan sepet + sunucu doğrulamalı sipariş; `/panel/siparisler` canlı liste ve detay (kabul / ret / servis / iptal).
- Kabul edilen sipariş ürün atamalarına göre **istasyon fişlerine** bölünür (Menü › Ürün › İstasyonlar; atama yoksa şubenin
  varsayılan istasyonu). İstasyonlar: `/panel/mutfak/istasyonlar`.
- Mutfak ekranı (KDS): `/panel/mutfak` — istasyon seçimi, süre / aciliyet, ses, tam ekran, ekranı açık tutma.
- Gerçek zamanlı: SSE (`/panel/olaylar`, müşteri `/t/<token>/siparis/<id>/akis`); bellek içi sağlayıcı tek süreç içindir,
  çok süreçli dağıtımda Redis sağlayıcısı takılmalı (bkz. `docs/architecture.md` §49).
- Demo seed: her şubede "Mutfak" (varsayılan) + "Bar"; ayran ve Türk kahvesi Bar'a yönlenir.

## Servis talepleri (Sprint 8)

- QR menüde "Servis": garson çağır, su, peçete, hesap, özel istek (onaylı; masa + tip başına tek aktif talep).
- `/panel/servis`: canlı ön salon panosu ("Ben ilgileniyorum" → "Tamamlandı"), metrikler, filtreler; `/panel/servis/gecmis`.
- Hesap talebi ödeme değildir (ödeme sonraki sprintlerde). Ayrıntılar: `docs/architecture.md` §57–62.

## Sesli AI asistan (Sprint 9)

- QR menüde "AI ile Konuş": bas-konuş sesli asistan (tr / en / de / ar / ru, konuşma içinde dil değişimi), yazılı yedek.
- Menü soruları, deterministik bütçe önerileri, sepet / servis ÖNERİLERİ (müşteri onaylar); asistan siparişi asla göndermez.
- Paket: AI (`ai_voice`) + `/panel/ai` ayarı + sağlayıcı. Kullanım: `/panel/ai`, `/admin/ai-kullanimi`.
- Sağlayıcı (OpenAI) yalnızca sunucu ortam değişkenleriyle: `AI_PROVIDER=openai`, `AI_API_KEY`, `VOICE_STT_PROVIDER=openai`,
  `VOICE_TTS_PROVIDER=openai` (ayrıntı `.env.example`). Geliştirme / test için `mock` (üretimde kullanmayın).
- Gerçek sağlayıcı duman testi (ücretli, isteğe bağlı): `AI_SMOKE=1 npm run test:ai-smoke`.
- Ham ses saklanmaz; AI geçmişi masa QR'ıyla paylaşılmaz (tarayıcıya özel kanıt). Ayrıntılar: `docs/architecture.md` §63–72.

## Canlı sesli konuşma (Sprint 10)

- "Sesli Konuşmayı Başlat": sürekli konuşma — ifade sonu sessizlikle algılanır (VAD), yanıt cümle cümle akar ve seslendirilir.
- Araya girme: asistan konuşurken konuşmaya başlamak ya da "Sözü Kes" sesi anında durdurur; eski yanıtın sesi / kartı gelmez.
- Bağlantı koparsa aynı turla yeniden bağlanır (yinelenen mesaj yok); sağlayıcı yoksa bas-konuş moduna kendiliğinden geçer.
- Sağlayıcı çağrıları ve araçlar yalnızca sunucuda; tarayıcıya anahtar verilmez, CSP değişmedi. `VOICE_REALTIME=off` canlı modu kapatır.
- İstatistik: `/panel/ai` (sesli oturum, süre, söz kesme, yedek), `/admin/ai-kullanimi` (ses dakikası, yedek ve hata oranı).
- Ayrıntılar: `docs/architecture.md` §73–83.

## Üretim sertleştirme (Sprint 11)

- **Redis (isteğe bağlı, PM2 kümede zorunlu):** `REDIS_URL` → gerçek zamanlı olaylar süreçler arası (Pub/Sub), hız
  sınırları paylaşılır (atomik). Redis yoksa tek süreç için bellek; Redis düşerse açık yedek (AI → ret, diğerleri → bellek).
- **Sağlık:** `GET /api/health` (veritabanı, Redis, gerçek zamanlı sağlayıcı, AI yapılandırması — sır yok).
- **Kapanış:** SIGTERM'de SSE → canlı ses turları → Redis → Prisma sırayla kapanır (`NEXT_MANUAL_SIG_HANDLE=true`).
- **AudioWorklet** mikrofon yakalama (yedek: ScriptProcessor), **SSRF** korumalı dış indirme, yapılandırılmış log +
  `x-request-id`, süreç metrikleri (`/api/admin/metrics`, Super Admin).
- Komutlar:
  - `npm run env:check` — ortam tanılaması (yalnızca ad / durum)
  - `npm run secrets:scan` — depo sır taraması (değer yazdırmaz)
  - `npm run test:regression` — tarayıcı paketleri, her biri TAZE sunucu sürecinde (yalıtılmış)
  - `npm run load:test` / `npm run load:db` / `npm run perf:qr` — yerel yük ve performans temeli
  - `npm run ai:retention -- --days 30 [--dry-run]` — süresi dolmuş AI konuşmalarını temizle (kullanım kayıtları kalır)
- Yayın kontrol listesi (DNS, Neon, Redis, OpenAI, PM2, Nginx, HTTPS, saklama, duman testleri):
  `docs/production-checklist.md`; örnekler `deploy/`. Mimari: `docs/architecture.md` §84–95.

## Üretim hazırlığı (Sprint 21)

| Komut | Ne yapar |
|---|---|
| `npm run checkpoint:verify` | Sır taraması · depo hijyeni · .gitignore · env · migration sağlığı · lint · typecheck · birim · Neon entegrasyon · derleme · kritik tarayıcı alt kümesi (ilk hatada durur) |
| `npm run release:verify` | checkpoint + tam S1–S20 regresyonu + `deploy:check --production` |
| `npm run deploy:check [-- --production]` | Dağıtım öncesi salt-okur denetim (env, DB, migration durumu, Redis, AI / ödeme durumu, UPLOAD_ROOT, disk, Node, sharp) |
| `npm run db:baseline:check` / `db:baseline:mark` | Migration geçmişi durumu; geçmişsiz ama uyumlu DB için onaylı işaretleme (reset YOK) |
| `npm run smoke -- --base … [--qr …]` | Dağıtım sonrası salt-okur duman testi (üretimde güvenli) |
| `npm run redis:smoke` | Gerçek Redis duman testi (ad alanlı, FLUSH yok) |
| `npm run bootstrap:admin` | Üretim ilk Super Admin (tek seferlik; geliştirme seed'i üretimde reddedilir) |

Profil: `NODE_ENV` standart; dağıtım ortamı `APP_ENV` (development / test / staging / production). Üretimde mock
sağlayıcılar yok sayılır. Belgeler: `docs/deployment.md`, `docs/rollback.md`, `docs/migration-baseline.md`,
`docs/baseline-sprint20.md`.

## Abonelik ve paket yetkileri (Sprint 20)

- **Paketler:** STARTER (QR menü, masalar, QR etiketleri, tema) · PRO (+ sipariş, KDS, istasyonlar, servis, analitik,
  rezervasyon, CRM, sadakat, kampanya, ödeme) · AI (+ sesli AI, İşletme Danışmanı). Tek kaynak: `src/config/plans.ts`.
- **Sunucuda uygulanır:** `src/server/billing/entitlements.ts` (kanonik çözücü) — menüyü gizlemek güvenlik değildir.
  Özellik yoksa: panelde kilit ekranı ya da (mevcut kayıtlar için) devam bandı; eylemler `feature_disabled` döner.
- **Faturalama sağlayıcısı YOK (manuel):** Super Admin `/admin/abonelikler` ve işletme › "Abonelik & Plan" sekmesinden
  paket, deneme, dönem, iptal, durum ve istisnaları yönetir. Kart / ödeme formu yok; fiyat / MRR uydurulmaz.
- **Sahip:** `/panel/abonelik` — paket, durum, tarih, özellikler, limit / kullanım (%80 / %90 / %100 uyarı), karşılaştırma.
- **Deneme:** yeni işletme `DEFAULT_TRIAL_DAYS` (14) gün; bitince Starter (veri silinmez). **Ek süre:** dönem bitince 7 gün
  (AI kapalı, operasyon sürer). Politika: `src/config/billing.ts`. Limitler GEÇİCİDİR. Mimari: `docs/architecture.md` §151–157.

## Ödemeler (Sprint 19)

- **Müşteri:** kabul edilmiş siparişin sayfasında "Ödeme Yap" → Tamamını Öde / Tutar Gir / Hesabı Böl (eşit pay) /
  Ürünlerini Seç. Tutar her zaman sunucuda, siparişin kayıtlı toplamından (Sprint 18 indirimi dahil) hesaplanır.
  Barındırılan ödeme sayfasından dönüşte "Ödeme doğrulanıyor…"; başarı YALNIZCA imzalı webhook ya da sağlayıcı
  sorgusuyla kesinleşir.
- **Panel:** `/panel/odemeler` (liste + filtre, ayrıntı: denemeler / dağılım / iadeler, iade, mutabakat) ve
  `/panel/odemeler/ayarlar`. Sipariş ayrıntısında ödeme kartı ve "Kasada ödeme kaydet" (nakit / POS / diğer).
- **Sağlayıcı:** `PAYMENT_PROVIDER=mock` yalnızca TEST sağlayıcısıdır (gerçek para çekilmez). Gerçek sağlayıcı
  adaptörü YOK — **gerçek ödeme sağlayıcısı doğrulanmadı**. Boşken online ödeme gizlenir; sipariş verme etkilenmez.
- Kart numarası / CVV saklanmaz (yalnızca marka + son 4). Webhook: `POST /api/v1/payments/webhook/<sağlayıcı>`.
  Mimari: `docs/architecture.md` §144–150.

## Kuponlar, ödüller ve kampanyalar (Sprint 18)

- **Panel:** `/panel/kampanyalar` — Kampanyalar (taslak + izin odaklı kitle önizlemesi), Kuponlar (sabit / yüzde /
  ücretsiz ürün; şube, kapsam, tarih / gün / saat, kullanım sınırları), Sadakat Ödülleri (puanla).
- **Müşteri:** QR sepetinde "Kupon kodu → Uygula" ya da "Puanlarını kullan"; ara toplam / indirim / toplam sunucudan.
  Siparişte tek kupon YA DA tek ödül. Ret / iptalde puan otomatik iade (tek kez).
- **Gönderim YOK:** SMS / e-posta / WhatsApp sağlayıcısı bağlı değil; kampanyalar taslak ve kitle sayısıdır.
- "Sipariş Tutarı" analitikte NET tutardır (indirim sonrası). Mimari: `docs/architecture.md` §138–143.

## Rezervasyonlar (Sprint 17)

- **Müşteri:** restoranın alan adında `/rezervasyon` — hesap gerekmez; tarih, kişi, gerçekten müsait saatler, iletişim.
  Onaydan sonra opak bir yönetim bağlantısı (`/rezervasyon/y/…`) ile görüntüleme / iptal.
- **Panel:** `/panel/rezervasyonlar` — Bugün / Yarın, liste, zaman çizelgesi, takvim, Walk-in Ekle, Masaya Al,
  Tamamla, İptal, Gelmedi; masa değiştirme (sahip / müdür). Ayarlar: kurallar, açılış saatleri, kapalı dönemler,
  masa birleşimleri. Masa kapasitesi Masalar & QR'dan.
- **Çift rezervasyon yok:** şube kilidi + kilit altında yeniden hesap + veritabanı EXCLUDE kısıtı.
- Varsayılan KAPALI. Ödeme / depozito / SMS / e-posta hatırlatma yok. Mimari: `docs/architecture.md` §132–137.

## Müşteriler ve sadakat (Sprint 16)

- **İsteğe bağlı:** müşteri sipariş için hiçbir bilgi vermez. Sipariş sonrası sakin bir davetle ("Bilgilerimi ekle")
  telefon / e-posta, ad ve onaylarını paylaşabilir; QR menüde küçük "N puan" bağlantısı görünür.
- **Panel:** `/panel/musteriler` (liste, arama, ayrıntı, elle ekleme) ve `/panel/sadakat` (aç / kapa, "1 puan için
  gereken tutar", kazanım anı). Yalnızca sahip ve şube müdürü; destek modunda iletişim maskeli.
- **Sadakat:** varsayılan KAPALI; puan servis edilen siparişte, sipariş başına TEK kez (veritabanı garantisi).
- **Doğrulama:** gerçek SMS / e-posta sağlayıcısı yok → `CONTACT_VERIFICATION_PROVIDER` boş bırakılır, katılım
  "doğrulanmamış" kaydedilir. `mock` yalnızca test içindir. Kampanya / SMS / e-posta / WhatsApp GÖNDERİLMEZ.
- Mimari: `docs/architecture.md` §126–131.

## İşletme Danışmanı (Sprint 15)

- **Konum:** `/panel/ai/danisman` (AI › İşletme Danışmanı). Sahip ve şube müdürü erişir; AI paketinde, sunucuda
  uygulanır.
- **Ne yapar:** "Ne değişti, neden önemli, neyi gözden geçirebilirim?"
  - Deterministik kurallar sipariş, ortalama sipariş, hazırlama süresi, istasyon darboğazı, servis yanıtı, bölge
    farkı, ürün ivmesi, menü karması ve AI kullanımı üzerinde çalışır.
  - Kuralları geçen içgörüler önceki eşdeğer dönemle karşılaştırılır.
  - Her kart veri kalitesi etiketi ve "Bu nasıl hesaplandı?" ayrıntısı taşır.
- **Salt okunur:** fiyat, menü, istasyon, personel ya da ayar değiştirmez; öneriler "değerlendirilebilir" dilindedir.
- **AI açıklaması:** isteğe bağlıdır; "Analizi Yenile" ile istenir ve hız sınırlıdır.
  - Yalnızca hesaplanan rakamları kullanabilir; kâr / marj, personel değerlendirmesi ya da neden-sonuç iddiası
    reddedilir.
  - Sağlayıcı yoksa kartlar deterministik metinle gösterilir.
- Mimari: `docs/architecture.md` §120–125.

## Ana sayfa (Sprint 14)

- `/`: platform pazarlama sayfası; yalnızca kök alan adında, kiracı alan adlarında restoran deneyimi açılır.
- Metinler `src/content/marketing/copy.ts` dosyasında; bileşenler `src/components/marketing/` altında.
- Hareketli hero, sessiz sesli AI demosu (TR → EN), KDS / servis / analitik canlandırmaları ve yapışkan ürün anlatısı
  var. Hareket azaltma tercihine ve JS kapalı kullanıma uyar.
- Paketler `config/plans.ts` tablosundan gelir; fiyat yazılmaz ("Fiyat için iletişime geçin").
- İsteğe bağlı WhatsApp düğmesi: `NEXT_PUBLIC_CONTACT_WHATSAPP` (yalnızca rakam, derlemeye gömülür).
- Mimari: `docs/architecture.md` §114–119.

## Görsel yükleme (Sprint 13)

- Panelden bilgisayardan yükleme (sürükle-bırak ya da dosya seçici):
  - **Ürün görseli:** Menü › Ürün › Görseller.
  - **Kategori banner'ı:** Kategoriler › Düzenle.
  - **Logo ve QR menü kapağı:** Tema & Tasarım.
- Önerilen boyutlar:

| Görsel | Önerilen | Oran | Sınır |
| --- | --- | --- | --- |
| Ürün | 1600 × 1200 px | 4:3 | 10 MB |
| Kategori banner'ı | 1500 × 500 px | 3:1 | 10 MB |
| Kapak | 1920 × 640 px | 3:1 | 15 MB |
| Logo | 512 × 512 px (şeffaf PNG / WebP) | 1:1 | 5 MB |

- Bu boyutlar öneridir, zorunlu değildir; görüntü bunlara göre ortalanarak kırpılır (logo kırpılmaz).
- Kabul edilen biçimler: JPEG, PNG, WebP. SVG / GIF kabul edilmez.
- Görseller sunucuda WebP'ye dönüştürülür. Konum (GPS) dahil tüm meta veri silinir.
- Dosyalar `UPLOAD_ROOT` klasörüne yazılır (geliştirmede `./storage/uploads`, git dışı). Üretimde uygulama dışında kalıcı
  bir klasör kullanılmalı ve **ayrıca yedeklenmelidir** — veritabanı yedeği görselleri içermez.
- Eski https görsel adresleri çalışmaya devam eder.
- Yetim dosya temizliği: `npm run media:cleanup -- --dry-run`.
- Mimari: `docs/architecture.md` §106–113; yayın: `docs/production-checklist.md` §16.

## Analitik (Sprint 12)

- **`/panel/analitik`** (sahip, yönetici) şunları gösterir:
  - KPI'lar, sipariş hunisi, eğilim ve ısı haritası.
  - Ürün, varyant, ekstra ve kategori kırılımları; menü dörtlü tablosu.
  - Masa ve bölge performansı.
  - KDS süreleri (medyan, p90) ve servis talepleri.
  - AI kullanımı (dil, eylem).
- Tarih aralıkları işletme / şube saat diliminde hesaplanır. Önceki dönemle karşılaştırılır (süren dönemde aynı geçen
  süreyle) ve şubeye göre filtrelenebilir.
- **"Sipariş Tutarı"** = kabul edilmiş ve reddedilmemiş / iptal edilmemiş siparişlerin toplamı. Gelir, kâr ya da marj
  değildir.
- CSV dışa aktarma (sipariş, ürün, servis, KDS): formül kaçışlı; en fazla 50.000 satır / 366 gün; destek modunda kapalı.
- 45 sn önbellek (Redis varsa paylaşılır). Mimari: `docs/architecture.md` §96–105.

## Super Admin (Sprint 2)

| Rota | İşlev |
|---|---|
| `/admin` | Gösterge paneli: işletme/şube/kullanıcı sayıları, durum dağılımı, son işletmeler, son denetim, hızlı eylemler |
| `/admin/isletmeler` | Sunucu tarafı arama (ad, kısa ad, alan adı, sahip e-postası), durum/paket filtresi, sıralama, sayfalama, onaylı durum eylemleri |
| `/admin/isletmeler/yeni` | 7 adımlı onboarding sihirbazı (tek transaction) |
| `/admin/isletmeler/[id]` | Sekmeler: Genel · Şubeler · Domainler · Kullanıcılar · Plan & Özellikler · Audit; durum geçişleri; Destek Modu |
| `/admin/subeler`, `/admin/subeler/yeni` | Tüm şubeler; işletme seçerek yeni şube |
| `/admin/domainler` | Tüm alan adları, tür / doğrulama filtresi |
| `/admin/demo-talepleri` | Landing formundan gelen talepler: durum + iç notlar |
| `/admin/audit-logs` | İşletme, aktör, eylem, varlık ve tarih aralığı filtreleri |

Özel alan adı doğrulaması için TXT kaydı: `_masanova-verification.<alan-adı>` → `masanova-verification=<token>`
(talimat işletmenin Domainler sekmesinde). Ayrıntılar: [`docs/architecture.md`](docs/architecture.md) §8–§17.

## Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `DATABASE_URL` | ✓ | Neon **pooled** bağlantı (`-pooler` host). `?sslmode=require&pgbouncer=true&connection_limit=5` önerilir |
| `DIRECT_URL` | ✓ | Neon **direct** bağlantı (`-pooler` eki yok). Migration ve seed bunu kullanır |
| `NEXT_PUBLIC_APP_URL` | ✓ | Platformun tam adresi. Yerel: `http://localhost:3000` |
| `NEXT_PUBLIC_ROOT_DOMAIN` | ✓ | Kiracı alt alanlarının kökü. Yerel: `localhost:3000`, prod: `masanovai.com` |
| `NODE_ENV` | | `development` / `production` |
| `QR_TOKEN_SECRET` | ✓ | Masa QR adreslerini türeten HMAC sırrı (≥ 32 karakter, `openssl rand -base64 48`). Değişirse basılı QR'lar çalışır ama yeniden **indirilemez** (QR yenilenmeli) |
| `QR_ENTRY_ORIGIN` | | Basılı QR'ların kodladığı kararlı giriş origin'i (prod önerisi `https://go.masanovai.com`). Boşsa `NEXT_PUBLIC_APP_URL`. **Etiket basıldıktan sonra değiştirmeyin** |
| `SEED_SUPER_ADMIN_EMAIL` / `_PASSWORD` | | Seed kullanıcısı. Parola boşsa rastgele üretilir |
| `SEED_TENANT_OWNER_EMAIL` / `_PASSWORD` | | Demo işletme sahibi |

`.env`, `.env.local`, `.env.production` (ve tüm `.env.*`, `.env.example` hariç) git tarafından yok sayılır.
Değişkenler Zod ile doğrulanır; eksik/hatalı olduğunda sunucu açılışta hangi değişkenin sorunlu olduğunu
(değerini değil) söyleyerek durur. `next build` veritabanı sırları olmadan da çalışır.

## Veritabanı komutları

```bash
npx prisma generate              # Prisma Client üret (npm install sonrası otomatik)
npm run db:diff                  # GÜVENLİ: şema değişikliğinin SQL'i (canlı şema → schema.prisma, shadow DB YOK)
npx prisma migrate deploy        # üretim / CI: yalnızca bekleyen migration'ları uygula (npm run db:deploy)
npx prisma db seed               # seed (npm run db:seed) — idempotent
npx prisma studio                # veri tarayıcısı
```

> **Güvenlik kilidi (prisma/guard.ts, prisma.config.ts üzerinden HER prisma komutunda):** shadow veritabanı
> `DATABASE_URL` / `DIRECT_URL` ile aynı veritabanı olamaz (Neon pooler / doğrudan host eşdeğerliği dahil) —
> Prisma shadow DB'yi SIFIRLAR. `migrate reset`, `migrate dev`, `db push --force-reset / --accept-data-loss` varsayılan
> olarak engellidir; yalnızca YEREL test veritabanında `MASANOVA_ALLOW_DB_RESET=I_UNDERSTAND_THIS_DROPS_DATA` ile
> çalışır. Yeni migration: `npm run db:diff` çıktısını `prisma/migrations/<tarih>_<ad>/migration.sql` olarak kaydedin.

Migration'lar `prisma/migrations` altında versiyonludur. Neon'da migration'ları **her zaman `DIRECT_URL`**
üzerinden çalıştırın (Prisma `directUrl` bunu otomatik yapar); pooler üzerinden çok komutlu transaction'lar
sessizce kaybolabiliyor.

### Seed

`prisma/seed.ts` şunları oluşturur (tekrar çalıştırmak güvenlidir):

| Kayıt | Değer |
|---|---|
| Kiracı | **3Y Demo Restaurant** · `demo-restoran` · ACTIVE → `demo.localhost` |
| Kiracı | **Askıdaki Demo** · `askida-demo` · SUSPENDED → `askida.localhost` (askı akışı testi) |
| Şube | Merkez Şube (İstanbul / Beyoğlu) |
| Ayarlar | `tr` · `TRY` · `Europe/Istanbul` |
| Kullanıcı | Super Admin — `admin@masanovai.local` |
| Kullanıcı | Demo işletme sahibi — `owner@demo-restoran.local` |
| Şube | Kadıköy Şube (şubeye özel fiyat ve "tükendi" örnekleri) |
| Menü | 7 kategori (iç içe İçecekler), 7 ürün, varyantlar, 3 ekstra grubu, malzemeler, alerjenler, etiketler, EN/DE/AR çeviriler — görsel yok (telifli fotoğraf kullanılmaz) |
| Masalar | Merkez Şube: İç Salon (Masa 1–8), Bahçe (Masa 9–12), her masada etkin QR |

**Parolalar kaynak kodda yoktur.** `SEED_*_PASSWORD` boşsa seed güçlü rastgele parola üretir ve **yalnızca
kullanıcı ilk oluşturulduğunda bir kez** konsola yazar. Bu hesaplar yalnızca geliştirme içindir; seed
`NODE_ENV=production` iken çalışmayı reddeder. Parolayı yenilemek için `SEED_*_PASSWORD` verip seed'i tekrar çalıştırın.

## Yerel kiracı testi

Modern tarayıcılar (Chrome, Edge, Firefox) `*.localhost` adlarını DNS veya hosts dosyası gerekmeden
`127.0.0.1`'e çözer.

| Adres | Beklenen |
|---|---|
| http://localhost:3000 | Landing (platform) |
| http://localhost:3000/giris | Giriş |
| http://localhost:3000/admin | Super Admin (SUPER_ADMIN oturumu) |
| http://localhost:3000/panel | Restoran paneli (kiracı kullanıcısı oturumu) |
| http://demo.localhost:3000 | 3Y Demo Restaurant public sitesi |
| http://askida.localhost:3000 | "Hizmet vermiyor" ekranı (SUSPENDED) |
| http://olmayan.localhost:3000 | 404 |
| http://demo.localhost:3000/panel | → `localhost:3000/panel`'e yönlendirilir |
| http://demo.localhost:3000/api/v1/tenant | Kiracının public JSON bilgisi |
| http://localhost:3000/api/health | `{ "status": "ok", "database": "connected", … }` |

Komut satırından (tarayıcısız) Host başlığıyla:

```bash
curl -H "Host: demo.localhost:3000" http://localhost:3000/api/v1/tenant
curl -H "Host: olmayan.localhost:3000" http://localhost:3000/api/v1/tenant   # 404 TENANT_NOT_FOUND
curl -H "Host: askida.localhost:3000" http://localhost:3000/api/v1/tenant    # 403 TENANT_UNAVAILABLE
```

Safari `*.localhost` çözmezse hosts dosyasına `127.0.0.1 demo.localhost` satırı ekleyin.
Yeni bir yerel kiracı için: Tenant + `TenantDomain(hostname="<etiket>.localhost", type=SUBDOMAIN, verified=true)`.

## Kalite komutları

```bash
npm run lint              # ESLint (kapsam üreticilerinin yanlış yerden import'u da hata)
npm run typecheck         # tsc --noEmit
npm test                  # birim testleri (DB gerekmez)
npm run test:integration  # gerçek DB: çözümleme, izolasyon, onboarding transaction/rollback, DNS doğrulama, şube IDOR, durum geçişleri
npm run build             # üretim derlemesi
npm start                 # üretim sunucusu
```

## Üretim

```bash
npm ci
npx prisma migrate deploy
npm run build
npm start
```

Üretimde: `NEXT_PUBLIC_ROOT_DOMAIN=masanovai.com`, `NEXT_PUBLIC_APP_URL=https://masanovai.com`,
DNS'te `*.masanovai.com` wildcard kaydı ve wildcard TLS sertifikası. Özel alan adları için müşteri CNAME'i
platforma yönlendirir; `TenantDomain.verified` doğrulama akışı Sprint 2'de.

## Klasör yapısı

```
prisma/                 schema.prisma · migrations/ · seed.ts
src/
  app/
    (marketing)/        landing (/)
    (auth)/giris/       giriş
    admin/              Super Admin kabuğu (+ sistem, audit-logs, ui-kit)
    panel/              restoran paneli kabuğu
    site/               kiracı public sitesi (proxy rewrite hedefi) + site/platform/* (platforma yönlendirme)
    api/health · api/v1/tenant
  components/
    ui/                 tasarım sistemi primitifleri
    layout/             DashboardShell, sidebar, mobil çekmece, kullanıcı menüsü
    dashboard/ · marketing/ · shared/
  config/               site, navigasyon (menü + bölüm tanımları)
  lib/
    auth/               parola, oturum, kapılar (guards)
    db/                 Prisma singleton
    tenant/             host normalizasyonu, çözümleme, bağlam, kapsam, hatalar
    permissions/        rol → yetki matrisi
    security/           başlıklar, hız sınırı, istek bilgisi, API hata biçimi
    validation/         Zod şemaları
  server/
    repositories/       tüm Prisma sorguları (kiracı kapsamlı)
    services/           giriş, denetim, sistem sağlığı
    actions/            Server Action'lar
  proxy.ts              host tabanlı yönlendirme (Next 16 "middleware")
tests/unit · tests/integration
```
