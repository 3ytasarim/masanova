# Kontrol noktası manifestosu — Sprint 20 temel çizgisi (Sprint 21'de hazırlandı)

İlk Git kontrol noktasının içeriği ve durumu. Sır içermez. Önerilen etiket: `v0.20.0-baseline`.

## Özellikler (Sprint 0–20)

| Alan | İçerik |
|---|---|
| Platform | Çok kiracılı SaaS, alan adı / alt alan çözümleme, Super Admin, onboarding, destek modu (salt okunur), denetim kaydı |
| Menü | Kategoriler, ürünler, varyantlar, ekstralar, alerjen / diyet etiketleri, TR/EN/DE/AR çeviri, şube fiyatları, görsel yükleme |
| Masa & QR | Bölgeler, masalar, HMAC QR token'ları, kararlı QR girişi (`/q/<token>`), baskıya hazır etiketler (PDF) |
| Müşteri QR deneyimi | Tema / düzenler, sepet, sipariş, canlı sipariş durumu, servis talepleri, isteğe bağlı müşteri hesabı |
| Operasyon | Sipariş paneli, hazırlık istasyonları + KDS, servis panosu, rezervasyon (masa planlama, walk-in) |
| CRM / sadakat / promosyon | İzinli müşteri kaydı, KVKK onayları, puan defteri, kupon / ödül / kampanya taslağı (gönderim YOK) |
| Ödemeler | Tam / kısmi / eşit / kalem bazlı bölme, rezervasyon + yarış güvenliği, webhook, iade, kasa kaydı — **yalnızca TEST sağlayıcısı** |
| AI | Sesli asistan (bas-konuş + canlı akış), AI İşletme Danışmanı — **gerçek sağlayıcıyla doğrulanmadı** |
| Analitik | Sipariş / ürün / masa / mutfak / servis / AI / promosyon / ödeme metrikleri, CSV |
| Abonelik | STARTER / PRO / AI sunucuda uygulanır; manuel faturalama (Super Admin), deneme, ek süre, limitler, istisnalar |
| Pazarlama | Animasyonlu ana sayfa, paket kartları (fiyat uydurulmaz), demo formu, OG görselleri |
| Sertleştirme | Redis soyutlaması (olay yolu + hız sınırı), SSRF koruması, günlük redaksiyonu, nazik kapanış, açılış denetimleri, health / ready |

## Gerçek sağlayıcı açıkları (üretim engelleri)

| Sağlayıcı | Durum |
|---|---|
| OpenAI (AI / STT / TTS) | **DOĞRULANMADI** — `AI_API_KEY` yok; `AI_SMOKE=1 npm run test:ai-smoke` hiç koşmadı. Üretimde AI kapalı başlar. |
| Redis | **DOĞRULANMADI** — gerçek sunucu yok; yalnızca protokol uyumlu sahte Redis ile test edildi (`npm run redis:smoke`). Küme kipi Redis olmadan açılmaz. |
| Restoran online ödeme | **YALNIZCA MOCK** — gerçek adaptör yok; mock üretimde yok sayılır, online ödeme kapalı. |
| SaaS faturalama | **MANUEL** — sağlayıcı / fatura / vergi yok. |
| SMS / e-posta / WhatsApp | **YOK** — iletişim doğrulaması ve kampanya gönderimi kapalı. |

## Bilinen sınırlamalar

- Ticari limit değerleri GEÇİCİ (`LIMITS_PROVISIONAL`); fiyatlar tanımsız.
- Bazı DE / AR müşteri metinleri (promosyon, ödeme, rezervasyon) İngilizceye düşer; Arapça metinler anadili incelemesi bekler.
- Gece yarısını aşan rezervasyon çalışma saatleri desteklenmez.
- Süresi dolan ödeme rezervasyonları istek tetiklemeli serbest kalır (zamanlanmış temizlik yok).
- POS / muhasebe / e-fatura entegrasyonu yok; ters ibraz yönetimi yok.
- Personel limiti tanımlı ama panelde personel oluşturma akışı yok; bazı "devam" kipindeki sayfalarda oluşturma düğmeleri görünür (sunucu reddeder).
- Zamanlanmış işler (AI saklama, medya temizliği) elle / tek cron ile; PM2 içinde zamanlayıcı yok.

## Migration durumu

- 21 migration (`20261008000000_init` … `20261230000000_sprint20_subscriptions`); yıkıcı SQL yok; boş veritabanında şemayı
  birebir üretir (PGlite kuru denemesi: fark yok; tetikleyici / CHECK / EXCLUDE adları geliştirme DB ile eşit).
- Geliştirme DB'si: `BASELINE_NEEDED` (geçmiş tablosu yok, şema eşleşiyor) — işaretleme yapılmadı. Bkz. migration-baseline.md.
- Sonraki migration adları `20261230000000`'dan büyük olmalı.

## Testler (Sprint 21 sonunda)

| Katman | Sonuç |
|---|---|
| Birim (Vitest) | 788 / 788 (44 dosya) |
| Neon entegrasyon | 297 / 297 (19 dosya) |
| Tarayıcı regresyonu S1–S20 | bkz. Sprint 21 raporu (tam koşu) |
| Temiz kurulum kuru denemesi | `npm ci` → typecheck → üretim derlemesi → `APP_ENV=production` açılış → salt-okur duman 14/14 + oturumlu duman 12/12 |

## Performans referansı (yerel → Neon; SLA değildir)

| Ölçüm | p50 | p95 |
|---|---|---|
| Ana sayfa (tarayıcı, `load`) | ~0,5 sn | — |
| QR menü (tarayıcı, `networkidle2`) | ~2,5 sn | — |
| Analitik paneli (tarayıcı) | ~2,1 sn | — |
| Sipariş gönderimi (servis; promosyonsuz / kuponlu) | 783 / 1121 ms | 824 / 1179 ms |
| Rezervasyon müsaitlik / oluşturma (100 masa, 10 bin kayıt) | 218 / 827 ms | 713 / 1301 ms |
| Ödeme (mock): barındırılan başlatma / webhook / kasa | 861 / 743 / 663 ms | 963 / 851 / 803 ms |

## Dağıtım gereksinimleri

Node 24.x, npm 11, Neon PostgreSQL (pooler + doğrudan uç nokta, `btree_gist`), yazılabilir kalıcı `UPLOAD_ROOT`, Nginx (TLS,
joker DNS), PM2; küme için Redis ≥ 7. Ayrıntı: [deployment.md](deployment.md).
