# Migration baseline (Sprint 21)

MasaNova veritabanı şeması `prisma/migrations/` altındaki **21 migration** ile tanımlıdır. Geliştirme sırasında migration'lar
`prisma db execute` ile uygulandığından geliştirme veritabanında Prisma'nın geçmiş tablosu (`_prisma_migrations`) **yoktur**.
Bu belge, üretime ilk geçişte bu durumun GÜVENLE nasıl ele alınacağını anlatır.

> **Asla kullanılmaz:** `prisma migrate reset`, uzak veritabanına karşı `prisma migrate dev`, geliştirme / üretim veritabanını
> gösteren shadow DB, `db push --force-reset` / `--accept-data-loss`. `prisma/guard.ts` bunları zaten engeller
> (2026-10-11'de shadow DB = geliştirme DB yüzünden tüm veri silindi).

## Envanter (zaman sırası)

| # | Migration | İçerik |
|---|---|---|
| 1 | `20261008000000_init` | Kiracı, şube, kullanıcı, oturum, denetim |
| 2 | `20261009000000_sprint2_onboarding_domains_demo` | Onboarding, alan adları, demo talepleri |
| 3 | `20261010000000_sprint3_menu` | Menü, çeviriler, alerjenler, şube fiyatları |
| 4 | `20261011000000_sprint4_tables_qr` | Bölgeler, masalar, QR token'ları |
| 5 | `20261012000000_sprint5_public_menu` | Public menü ayarları |
| 6 | `20261013000000_sprint6_orders` | Siparişler, kopyalar, sıra numarası |
| 7 | `20261014000000_sprint7_kds` | İstasyonlar, fişler |
| 8 | `20261014010000_sprint7_default_station_branch` | Varsayılan istasyon (bileşik FK) |
| 9 | `20261015000000_sprint8_service_requests` | Servis talepleri |
| 10 | `20261016000000_sprint9_voice_ai` | AI ayarları, konuşma, kullanım |
| 11 | `20261016010000_sprint9_usage_no_fk` | Kullanım kaydı FK kaldırma |
| 12 | `20261017000000_sprint10_realtime_voice` | Canlı ses turları |
| 13 | `20261018000000_sprint12_analytics_indexes` | Analitik dizinleri |
| 14 | `20261101000000_sprint13_media_assets` | Medya varlıkları |
| 15 | `20261115000000_sprint15_business_advisor` | İşletme Danışmanı |
| 16 | `20261201000000_sprint16_crm_loyalty` | CRM, onay, sadakat |
| 17 | `20261215000000_sprint17_reservations` | Rezervasyon (btree_gist EXCLUDE) |
| 18 | `20261220000000_sprint18_promotions` | Kupon, ödül, kampanya |
| 19 | `20261220000100_sprint18_ledger_reversal` | `REVERSAL` enum değeri (ayrı işlem) |
| 20 | `20261225000000_sprint19_payments` | Ödemeler + tetikleyiciler |
| 21 | `20261230000000_sprint20_subscriptions` | Abonelik + geri doldurma |

Doğrulamalar (Sprint 21):

- Adlar benzersiz, `YYYYMMDDHHMMSS_ad` biçiminde, sözlük sırası = uygulama sırası; her klasörde boş olmayan `migration.sql`.
- Yıkıcı SQL yok (`DROP TABLE / SCHEMA / COLUMN`, `TRUNCATE`): `npm run db:baseline:check` her koşuda tarar.
- **Boş veritabanında yeniden üretilebilirlik:** 21 migration geçici, bellek içi bir PostgreSQL'e (PGlite + btree_gist)
  sırayla uygulandı → `prisma migrate diff --from-url <boş+21> --to-schema-datamodel` **fark yok**. Prisma'nın görmediği
  nesneler de geliştirme DB ile birebir: 86 tablo, 12 tetikleyici, 10 fonksiyon, 42 CHECK, 1 EXCLUDE (adlar eşit).
- Migration'lar yerel test durumuna bağlı değil; tek veri yazan adım Sprint 20 geri doldurması (her kiracı → mevcut paketinde
  ACTIVE abonelik — yalnızca var olan kiracılar için, idempotent `NOT EXISTS`).

> **Zaman damgası kuralı:** son migration `20261230000000`. Sonraki migration'ların adı bundan **büyük** olmalı (ör.
> `20270101000000_…`) — saat bugünün tarihini verse bile. Aksi halde sıralama bozulur ve `db:baseline:check` reddeder.

## Durum denetimi

```bash
npm run db:baseline:check     # salt-okur; DIRECT_URL hedefi (host maskeli yazılır)
```

| DURUM | Anlam | Yapılacak |
|---|---|---|
| `FRESH` | Boş veritabanı | Durum A |
| `BASELINE_NEEDED` | Geçmiş tablosu yok, şema schema.prisma ile BİREBİR | Durum B |
| `PENDING` | Geçmiş var, uygulanmamış migration var | geri yükleme noktası → `npm run db:deploy` |
| `IN_SYNC` | Geçmiş var, hepsi uygulanmış, şema eşleşiyor | işlem yok |
| `AMBIGUOUS` | Geçmiş yok + şema farklı; yarım kalmış / bilinmeyen migration; sıralama / ad hatası | **DUR** (aşağıda) |

Geliştirme veritabanının bugünkü durumu: **`BASELINE_NEEDED`** (21 migration'ın tamamı fiilen uygulanmış, geçmiş kaydı yok).

## Durum A — Yeni (boş) üretim veritabanı

1. Neon'da üretim projesini / dalını oluşturun; `DIRECT_URL` (pooler OLMAYAN) ve `DATABASE_URL` (pooler) ayarlayın.
2. `npm run db:baseline:check` → `FRESH` olmalı.
3. `npm run db:deploy` (`prisma migrate deploy`) — 21 migration sırayla uygulanır ve `_prisma_migrations` oluşur.
   `btree_gist` uzantısı migration içinde oluşturulur (Neon destekler).
4. `npm run db:baseline:check` → `IN_SYNC`.
5. İlk yönetici: `BOOTSTRAP_ADMIN_EMAIL=… npm run bootstrap:admin` (geliştirme seed'i üretimde REDDEDİLİR).

## Durum B — Şema uygun ama Prisma geçmişi yok (bugünkü geliştirme DB'si gibi)

Prisma'nın desteklediği yöntem: her migration'ı **çalıştırmadan** "uygulandı" olarak işaretlemek
(`prisma migrate resolve --applied <ad>`). DDL çalışmaz, veri değişmez; yalnızca `_prisma_migrations` doldurulur.

1. **Geri yükleme noktası alın** (Neon: dal / anlık görüntü — bkz. docs/deployment.md › Yedekleme). Varlığını DOĞRULAYIN.
2. `npm run db:baseline:check` → `BASELINE_NEEDED` (şema farkı YOK olmalı; varsa Durum B uygulanmaz).
3. Açık onayla işaretleyin:

   ```bash
   MASANOVA_BASELINE_CONFIRM=I_HAVE_A_RESTORE_POINT \
   MASANOVA_BASELINE_TARGET="<check çıktısındaki maskeli host>" \
   npm run db:baseline:mark
   ```

   Betik yalnızca `BASELINE_NEEDED` durumunda ve iki onay değişkeni doğruysa çalışır; maskeli host eşleşmesi yanlış veritabanını
   işaretlemeyi önler. Her migration için `prisma migrate resolve --applied` çağrılır; ilk hatada durur.
4. `npm run db:baseline:check` → `IN_SYNC`. Bundan sonra yeni migration'lar `npm run db:deploy` ile uygulanır.

## Belirsiz durum (`AMBIGUOUS`)

Hiçbir şey otomatik yapılmaz. `npm run db:diff` ile farkı (salt-okur SQL) inceleyin; elle yapılmış şema değişikliği, yarım
kalmış migration ya da yanlış hedef olabilir. Çözüm her zaman ileri yönlüdür (yeni migration) — veri silen geri alma yok.
Yarım kalmış migration için Prisma'nın `migrate resolve --rolled-back` / `--applied` komutları ancak durum elle doğrulandıktan
sonra kullanılır.

## Üretim veritabanı güvenliği

- Migration yalnızca `DIRECT_URL` ile ve dağıtım prosedüründeki geri yükleme noktası adımından SONRA çalışır.
- Host her çıktıda maskelidir; bağlantı dizesi / parola yazdırılmaz.
- Testler üretim veritabanına karşı ÇALIŞMAZ: `APP_ENV=production` ya da host `PRODUCTION_DB_HOSTS` listesindeyse tarayıcı,
  entegrasyon ve yük testleri başlamadan durur (`tests/e2e/lib/env-safe.cjs`).
