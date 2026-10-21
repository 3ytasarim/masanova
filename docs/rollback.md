# Geri alma (Sprint 21)

Kural: **kod geri alınır, veritabanı ileriye düzeltilir.** Bir ileri migration'dan sonra veritabanını körlemesine geri
yüklemek, aradaki siparişleri / ödemeleri / rezervasyonları siler. Down migration otomatik çalıştırılmaz.

## 1. Ne zaman

- `/api/ready` 503 ya da `npm run smoke` başarısız (geçişten sonraki 5 dakika içinde)
- Hata oranında / gecikmede belirgin artış, kritik akış (QR menü, sipariş, mutfak) bozuk

## 2. Uygulama geri alma (en sık)

```bash
cd /var/www/masanova
ls -1t releases | head -4                       # önceki sürümü bulun
ln -sfn /var/www/masanova/releases/<önceki> current
RELEASE_ID=<önceki> pm2 reload deploy/ecosystem.config.cjs --only masanova --update-env
curl -fsS https://masanovai.com/api/ready
npm --prefix current run smoke -- --base https://masanovai.com --expect-release <önceki>
```

- Önceki sürüm klasörü derlenmiş hâliyle durur → yeniden derleme gerekmez, geri alma saniyeler sürer.
- **Yüklemeler etkilenmez** (`/var/lib/masanova/uploads` sürüm klasörü dışında).
- Ortam dosyası ortaktır (`/etc/masanova/masanova.env`); yeni sürümle birlikte env değiştiyse §4.

## 3. Migration varsa

Migration'lar ileri uyumlu yazılır (yeni sütun / tablo eklenir, eskisi bir sürüm boyunca korunur) → önceki kod yeni şemayla
çalışır ve §2 yeterlidir.

Önceki kod yeni şemayla ÇALIŞMIYORSA:

1. **Tercih: ileri düzeltme** — sorunu düzelten yeni migration / yeni sürüm.
2. Veri kaybı kabul edilebilirse ve olay kısa sürdüyse: dağıtım öncesi alınan Neon dalına geri dönmek bir İŞ kararıdır —
   aradaki yazmalar (siparişler, ödemeler, rezervasyonlar, denetim kayıtları) kaybolur. Önce geri dönülecek dalda doğrulayın,
   gerekirse aradaki kritik kayıtları dışa aktarın.
3. Elle "down" SQL yalnızca gözden geçirilmiş, test dalında denenmiş bir betikle; `prisma migrate reset` ASLA.
4. Prisma geçmişi: geri alınan migration'ı `prisma migrate resolve --rolled-back <ad>` ile işaretleyin (yalnızca
   değişiklik fiilen geri alındıysa).

## 4. Ortam değişkeni geri alma

- `/etc/masanova/masanova.env` her değişiklikten önce kopyalanır: `cp masanova.env masanova.env.$(date +%F-%H%M)`.
- `NEXT_PUBLIC_*` değişikliği derlemeye gömülüdür → önceki sürüm klasörü önceki değerlerle derlenmiştir; env'i geri
  alıp önceki sürüme dönün.
- **`QR_TOKEN_SECRET` ve `QR_ENTRY_ORIGIN` asla "geri alma" kapsamında değiştirilmez** (basılı etiketler).

## 5. PM2

```bash
pm2 ls                                  # süreç durumu
pm2 logs masanova --lines 200           # son günlükler (JSON; sır içermez)
pm2 reload masanova --update-env        # sıfır kesinti (küme) / hızlı yeniden başlatma (tek süreç)
```

`pm2 save` yalnızca doğrulanmış durumdan sonra.

## 6. Doğrulama (geri almadan sonra)

1. `/api/ready` 200, `/api/health` → `status` ≠ `down`, `release` beklenen.
2. `npm run smoke -- --base … --qr <test-masa-QR>` → tümü ✓.
3. Panelde bir test siparişinin mutfak ekranına düştüğünü gözle doğrulayın (olaylar).
4. Olay kaydı: ne oldu, hangi sürüm, hangi karar (dal geri dönüşü yapıldıysa kaybolan zaman aralığı).
