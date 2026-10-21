# MasaNova AI — Mimari

> Kapsam: Sprint 0 (temel) + Sprint 1 (çok kiracılı çekirdek). Bu belge, kararların **neden** alındığını
> anlatır; kurulum adımları için `README.md`.

## 1. Genel bakış

```
                ┌──────────── proxy.ts (her istek, DB yok) ────────────┐
 Host başlığı → │ classifyHost(host, ROOT)                              │
                │  platform  → olduğu gibi (/, /giris, /admin, /panel)  │
                │  kiracı    → /site rewrite (public kiracı sitesi)     │
                │             /admin|/panel|/giris → /site/platform/* │
                │             (route handler → platforma 307)         │
                └───────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴──────────────────────────┐
  Sunucu bileşeni / Route Handler / Server Action
          │
          ├─ getTenantContext()  → resolveTenantByHost() → TenantDomain (tek global sorgu)
          ├─ requireTenant()     → TenantContext { tenant, scope }      (kiracı alan adı)
          ├─ requireTenantUser() → { user, tenant, scope }              (panel: oturum)
          └─ requireSuperAdmin() → { user, platform }                   (admin: oturum)
                                    │
                         src/server/repositories/*  (scope ZORUNLU parametre)
                                    │
                                 Prisma → Neon PostgreSQL
```

Katmanlar:

| Katman | Klasör | Sorumluluk |
|---|---|---|
| Rota | `src/app` | Yalnızca kapı (guard) çağırır, repository/service'ten veri alır, render eder |
| Kapılar | `src/lib/auth/guards.ts`, `src/lib/tenant/tenant-context.ts` | Kimlik + kiracı + yetki; **kapsam (scope) nesnelerini üreten tek yer** |
| Saf kurallar | `src/lib/tenant/host.ts`, `resolve-tenant.ts`, `src/lib/permissions` | Yan etkisiz, birim testli |
| Servis | `src/server/services` | Birden çok repository'yi + denetimi birleştiren iş akışları (giriş, denetim) |
| Repository | `src/server/repositories` | Tüm Prisma sorguları burada; kiracıya ait veride ilk parametre `TenantScope` |
| Veri | `prisma/` | Şema, versiyonlu migration'lar, seed |

## 2. Kiracı modeli

- **Tenant**: işletme (marka). `slug` benzersiz, `status` ∈ TRIAL | ACTIVE | SUSPENDED | CANCELLED.
- **TenantDomain**: kiracıya bağlı **tam hostname** (normalize: küçük harf, portsuz, sonda nokta yok).
  - `SUBDOMAIN`: `demo.masanovai.com` (platform alt alanı, doğrulama gerekmez)
  - `CUSTOM_DOMAIN`: `menu.restoran.com` (DNS doğrulaması tamamlanana kadar `verified=false` → çözümlenmez)
  - Alt alan adını etiket değil tam hostname olarak saklamak, iki türü tek benzersiz indeksle (`hostname`)
    çözmeyi ve ortamlar arası (localhost ↔ prod) açık kayıtları mümkün kılar.
- **Branch**: kiracının şubeleri; `(tenantId, slug)` benzersiz. Saat dilimi / para birimi / dil şube düzeyinde.
- **TenantSettings**: 1-1 marka ve yerelleştirme ayarları.
- **User**: `tenantId` yalnızca SUPER_ADMIN'de null. E-posta şimdilik platform genelinde benzersiz
  (bir kişinin birden çok işletmede çalışması gerekirse `Membership` tablosu eklenecek — bkz. §7).
- **Session**: veritabanı oturumu; çerezde ham token, veritabanında SHA-256 özeti.
- **AuditLog**: append-only; bilinçli olarak foreign key **yok** (kayıt, kullanıcı/kiracı silinse de bozulmaz).

## 3. Alan adı çözümleme

Tek doğruluk kaynağı: `src/lib/tenant/resolve-tenant.ts → resolveTenantByHost()`.

1. `normalizeHost()` — küçük harf, port ve sondaki nokta atılır; geçersiz karakter / uzunlukta `null`.
2. `classifyHost()` — `NEXT_PUBLIC_ROOT_DOMAIN`'e göre:
   - kök, `www.`, `app.`, IP adresleri → **platform**
   - kökün tek seviyeli alt alanı → **subdomain** (`RESERVED_SUBDOMAINS` hariç: admin, api, mail…)
   - çok seviyeli alt alan (`a.b.masanovai.com`) → **geçersiz**
   - kök dışı her şey → **custom**
3. Platform ve geçersiz host'larda **veritabanına gidilmez**.
4. `TenantDomain.hostname` ile tek sorgu. Ardından:
   - kayıt tipi host'un geliş biçimiyle eşleşmeli (kök altındaki bir host CUSTOM_DOMAIN kaydıyla ele geçirilemez),
   - CUSTOM_DOMAIN `verified` olmalı,
   - kiracı TRIAL/ACTIVE değilse `unavailable` (askı/iptal) döner — **tam bağlam ve kapsam üretilmez**.
5. Sonuç ayrık birleşim (discriminated union): `platform | tenant | not_found | unavailable`.

Çözümleme istek başına bir kez yapılır (`React.cache`). Lookup arayüzü (`TenantDomainLookup`) enjekte
edildiği için ileride LRU/Redis önbelleği çağıran kodu değiştirmeden eklenebilir.

**Neden proxy'de DB yok?** Proxy her istekte (statik varlıklar hariç) çalışır. Host sınıflandırması saf
fonksiyon olduğundan orada yapılır; veritabanı çözümlemesi yalnızca gerçekten kiracı verisi gereken
render'da yapılır.

### Güvenli yanıtlar

| Durum | Sayfa (`/site`) | API (`/api/v1/tenant`) |
|---|---|---|
| Bilinmeyen / geçersiz / doğrulanmamış host | 404 | `404 TENANT_NOT_FOUND` |
| Askıda / iptal | "hizmet vermiyor" ekranı, noindex | `403 TENANT_UNAVAILABLE` |
| Platform host'unda `/site` | 404 | `404 TENANT_NOT_FOUND` |

Yanıtlar hangi nedenle reddedildiğini (unverified, mismatch…) dışarı sızdırmaz; neden yalnızca sunucu
tarafındaki `TenantResolution.reason` alanında kalır.

## 4. Yetkilendirme stratejisi

### Kiracı kimliği nereden gelir?

| Yüzey | Kaynak | Kapı |
|---|---|---|
| Public kiracı sitesi / kiracı API'leri | Doğrulanmış alan adı (Host → TenantDomain) | `requireTenant()` |
| Restoran paneli (`/panel`) | Oturumdaki kullanıcının `tenantId`'si | `requireTenantUser()` |
| Platform yönetimi (`/admin`) | Oturumdaki SUPER_ADMIN | `requireSuperAdmin()` |

**Asla:** `request.body.tenantId`, sorgu parametresi, çerezde düz `tenantId`, gizli form alanı.

Panel ve admin yalnızca platform alan adında sunulur: proxy kiracı alan adındaki `/panel`, `/admin`,
`/giris` isteklerini `/site/platform/*` route handler'ına rewrite eder, o da izinli yol listesine göre
`NEXT_PUBLIC_APP_URL` üzerinde mutlak 307 üretir (açık yönlendirme yok). Yönlendirme proxy'de yapılmaz çünkü
Next, proxy yanıtındaki Location host'u sunucunun kendi host'uyla aynıysa URL'i göreceli yapar ve yerelde
(`demo.localhost:3000` → `localhost:3000`) sonsuz döngü oluşur. `requireTenantUser()` ayrıca, istek bir kiracı alan adından
gelirse o alan adının kiracısının oturumdaki kiracıyla aynı olduğunu doğrular (savunma derinliği).

### Kapsam (scope) nesneleri

`src/lib/tenant/scope.ts`:

- `TenantScope` — markalı (branded) tip; düz `{ tenantId }` nesnesi veya string, kapsamlı repository
  fonksiyonlarına **derleme anında** verilemez.
- `PlatformScope` — platform geneli sorgular için SUPER_ADMIN kanıtı.
- Üreticiler (`createTenantScope`, `createPlatformScope`) ESLint `no-restricted-imports` kuralıyla
  yalnızca `src/lib/tenant/**` ve `src/lib/auth/guards.ts` içinden çağrılabilir. Rota/servis kodu
  kapsamı ancak bir kapıdan alabilir.

### IDOR koruma deseni (her yeni model için zorunlu)

```ts
// ❌ YASAK — id başka kiracıya ait olabilir
prisma.product.findUnique({ where: { id: productId } });

// ✅ Okuma: id + scope'tan gelen tenantId
export function findProductById(scope: TenantScope, id: string) {
  return prisma.product.findFirst({ where: { id, tenantId: scope.tenantId } });
}

// ✅ Yazma: updateMany/deleteMany + tenantId → yabancı kayıt sessizce 0 satır
export async function renameProduct(scope: TenantScope, id: string, name: string) {
  const { count } = await prisma.product.updateMany({ where: { id, tenantId: scope.tenantId }, data: { name } });
  return count === 1; // false → çağıran "bulunamadı" (404) döner, 403 değil: varlık sızdırılmaz
}

// ✅ Oluşturma: tenantId gövdeden DEĞİL, scope'tan
prisma.product.create({ data: { ...validatedInput, tenantId: scope.tenantId } });

// ✅ İlişkili kayıt (ör. ürün → kategori) bağlanırken ilişkinin de aynı kiracıya ait olduğu doğrulanır
const category = await findCategoryById(scope, input.categoryId);
if (!category) return notFound();
```

Soft-404 notu: `loading.tsx` yalnızca `(overview)` route group'larında; bölüm rotaları `dynamicParams = false`
ile sabit listeye bağlı. Böylece `notFound()` akış başlamadan çalışır ve gerçek 404 döner.

Referans uygulama: `src/server/repositories/branch.repository.ts`. Testler:
`tests/unit/tenant-isolation.test.ts` (sahte Prisma), `tests/integration/tenant-isolation.test.ts` (gerçek DB).

Gelecekte ek katman: PostgreSQL Row-Level Security (`SET app.tenant_id` + RLS politikaları) —
uygulama katmanındaki kontrolün yerine değil, **ek** savunma olarak (bkz. §7).

### Roller ve yetkiler

`src/lib/permissions/roles.ts` rol → yetki matrisi. Menü görünürlüğü ve sunucu kapıları aynı tabloyu okur;
karar her zaman sunucuda verilir (`requireTenantUser({ permission: "menu.manage" })`). Yetkisiz erişim
404 döner (yüzeyin varlığı doğrulanmaz).

## 5. Kimlik doğrulama

- Parola: argon2id (OWASP parametreleri), kullanıcı yoksa sahte doğrulama (zamanlama ile e-posta keşfine karşı).
- Oturum: 256-bit rastgele token, `httpOnly`, `SameSite=Lax`, prod'da `Secure` + `__Host-` öneki, 7 gün mutlak süre.
  Veritabanında yalnızca SHA-256 özeti; oturum anında iptal edilebilir.
- Giriş hız sınırı: e-posta+IP başına 15 dakikada 5 deneme (`createMemoryRateLimiter`, tek örnek).
- Her giriş/çıkış/başarısız deneme `AuditLog`'a yazılır (parola asla loglanmaz).
- CSRF: Server Action'lar Next.js tarafından Origin/Host karşılaştırmasıyla korunur; çerez `SameSite=Lax`.
  Durum değiştiren Route Handler eklendiğinde Origin kontrolü zorunlu olacak.

## 6. Güvenlik temeli

- Güvenlik başlıkları (`src/lib/security/headers.ts`): CSP, HSTS (prod), X-Frame-Options DENY,
  nosniff, Referrer-Policy, Permissions-Policy, COOP. `/admin`, `/panel`, `/giris`, `/api` → `X-Robots-Tag: noindex`.
- CSP şu an `script-src 'self' 'unsafe-inline'` (Next.js hydration). Nonce tabanlı sıkı CSP, analitik ve
  ödeme sağlayıcıları netleştiğinde proxy'de nonce üretilerek devreye alınacak.
- Ortam doğrulaması (`src/lib/env.ts`, Zod): sunucu açılışında (`instrumentation.ts`) ve ilk DB erişiminde.
  Hata mesajı değer değil yalnızca değişken adı içerir. `server-only` ile sırlar istemci paketine giremez.
- API hata gövdesi tek biçim: `{ error: { code, message } }`; üretimde iç mesaj / yığın izi dönmez.
- Health endpoint sır, sürüm ve hata ayrıntısı içermez.

## 7. Gelecek modüller ve genişleme noktaları

| Modül | Sprint (plan) | Mimari hazırlık |
|---|---|---|
| İşletme / domain yönetimi (admin) | 2 | `TenantDomain`, `hostnameSchema`, `subdomainLabelSchema`, rezerve adlar |
| Menü, ürün varyant/opsiyon | 2 | Kapsamlı repository deseni, `menu.manage` yetkisi |
| Masalar, masaya özel QR | 2 | `/site` rewrite → kiracı public yüzeyi; `tables.manage` |
| Sipariş, KDS, garson çağrısı, realtime | 3 | Branch düzeyi saat dilimi/para birimi; rol matrisi (WAITER/KITCHEN/BAR) |
| AI metin/ses asistanı, menü zekâsı | 4 | Permissions-Policy `microphone=(self)`; AI kullanım sayaçları için AuditLog/ayrı tablo |
| CRM, kampanya, rezervasyon, analitik | 5 | Kiracı kapsamlı repository'ler |
| Paket / abonelik / ödeme | 6 | `TenantPlan` enum'u abonelik tablosuyla değiştirilecek |
| Çoklu işletme üyeliği | — | `User.tenantId` → `Membership(userId, tenantId, role)` geçişi |
| Ölçekleme | — | Rate limiter → Redis; tenant lookup → LRU/Redis önbellek; Postgres RLS |
| Çok dil | — | `TenantSettings.defaultLocale`, `Branch.locale`; menü içerik çevirileri ayrı tablo |
| Karanlık mod | — | Renkler CSS değişkeni; yalnızca `[data-theme=dark]` altında yeniden tanımlanacak |

---

# Sprint 2 — Super Admin, onboarding, alan adı yönetimi

## 8. Merkezi alan adı / URL katmanı (`src/lib/domain/`)

| Dosya | Görev |
|---|---|
| `normalize-domain.ts` | `normalizeHost()`, ayrılmış alt alan adları, DNS etiketi doğrulaması |
| `root-domain.ts` | `ROOT_HOSTNAME`, `ROOT_PORT` — yalnızca `NEXT_PUBLIC_ROOT_DOMAIN`'den |
| `get-platform-url.ts` | `PLATFORM_ORIGIN`, `getPlatformUrl(path)` — `NEXT_PUBLIC_APP_URL`'den |
| `get-tenant-url.ts` | `buildSubdomainHostname()`, `getTenantUrl()`, `formatTenantAddress()`, `isPlatformSubdomain()` |

Kodda sabit alan adı yoktur; tüm hostname/URL üretimi bu dört dosyadan geçer (seed dahil). Yerelde
`beyoglu.localhost:3000`, üretimde `beyoglu.masanovai.com` aynı koddan çıkar.

## 9. Restoran onboarding

`/admin/isletmeler/yeni` — 7 adımlı istemci sihirbazı (İşletme → Şube → Alan adı → Sahip → Marka → Paket → Özet).

- Her adım kendi `<form>`'u; Enter = Devam. Adım değişince odak adım başlığına taşınır, hata özeti `role=alert`.
- Aynı Zod şemaları (`src/lib/validation/tenant.ts`) istemcide anlık geri bildirim, sunucuda **tek yetkili** doğrulama için
  kullanılır. `tenantId`, `role`, `verified`, `isPrimary` hiçbir şemada yoktur — gönderilse bile ayıklanır (testli).
- Kısa ad işletme adından önerilir (Türkçe karakter dönüşümü), ayrılmış adlar reddedilir, benzersizlik sunucuda kontrol edilir
  (yazarken 450 ms gecikmeli Server Action + "Devam"da yeniden).
- Son adımda `onboarding.service.ts`:
  1. ön kontroller (kısa ad, alt alan, özel alan, e-posta) → alan bazlı hata,
  2. parola: "geçici" modda sunucuda `crypto.randomInt` ile üretilir; **yalnızca argon2id hash** saklanır,
  3. **tek `prisma.$transaction`**: Tenant (TRIAL) → TenantSettings → birincil Branch → SUBDOMAIN (doğrulanmış, birincil)
     → [CUSTOM_DOMAIN + DomainVerification(PENDING)] → TENANT_OWNER User → AuditLog satırları. Kullanıcı en son oluşturulur;
     herhangi bir hata her şeyi geri alır (entegrasyon testi gerçek bir benzersizlik ihlaliyle kanıtlar). Ön kontrol ile yazma
     arasındaki yarışı veritabanı benzersiz indeksleri yakalar (P2002 → alan hatası).
- Başarı ekranı geçici parolayı **bir kez** gösterir (kopyala düğmesi + "bir daha görüntülenemez" uyarısı). Parola yalnızca
  Server Action yanıtında bulunur; loglanmaz, denetime yazılmaz, sayfa yenilenince kaybolur. E-posta gönderimi sonraki sprint.

## 10. Alan adı doğrulama (DNS TXT)

```
_masanova-verification.<hostname>   TXT   "masanova-verification=<token>"
```

- `DomainVerification` (TenantDomain ile 1-1): `token`, `status` (PENDING/VERIFIED/FAILED), `failureReason`, `attempts`,
  `lastCheckedAt`, `verifiedAt`, `createdAt`.
- Token gizli bir kimlik bilgisi değildir (DNS'te herkese açık yayınlanır) ama denetim kayıtlarına yazılmaz; "Yeni kod üret" ile yenilenir.
- "Doğrulamayı kontrol et" **gerçek** bir Node DNS sorgusudur (`dns/promises` Resolver, 5 sn × 2 deneme). Yalnızca birebir
  eşleşen TXT değeri `verified=true` yapar; kayıt yok / farklı değer / DNS hatası / zaman aşımı → FAILED (+ neden + deneme sayısı).
- Çözümleyici yalnızca `TenantDomain.verified` alanını okur → doğrulanmamış özel alan adı public'te 404 (testli).
- Birincil alan adı yalnızca doğrulanmış bir alan adına aktarılabilir; platform alt alanı kaldırılamaz.
- **Kalan:** alan adının platforma yönlendirildiğinin (CNAME/A) kontrolü, TLS sertifikası (Vercel / Cloudflare for SaaS) ve
  periyodik yeniden doğrulama (cron) — Sprint 3+.

## 11. Durum makinesi (`src/lib/tenant/status.ts`)

```
TRIAL     → ACTIVE | SUSPENDED | CANCELLED
ACTIVE    → SUSPENDED | CANCELLED
SUSPENDED → ACTIVE | CANCELLED
CANCELLED → (terminal)
```

Geçiş `updateMany({ where: { id, status: from } })` ile uygulanır: iki yönetici aynı anda farklı geçiş yaparsa biri reddedilir.
Her geçiş `TENANT_STATUS_CHANGED` (aktör, önceki/yeni durum, gerekçe, zaman) yazar. Askıya alma/iptal hiçbir veriyi silmez;
kiracı fiziksel silme bu sprintte yoktur (ne UI ne servis).

## 12. Destek modu (güvenli "impersonation")

Uygulandı — bilinçli olarak dar kapsamla:

- Hedef bir **kiracıdır**, kullanıcı değil: başka bir kullanıcının (dolayısıyla başka bir Super Admin'in) kimliğine bürünülemez.
- Admin'in kendi oturumu korunur; `Session.supportTenantId/supportStartedAt` eklenir. Denetimde aktör her zaman gerçek admin'dir.
- Açık onay penceresiyle başlar; panelde ve admin'de kalıcı uyarı bandı; en fazla 60 dk; başlangıç/bitiş (çıkışta otomatik bitiş) denetlenir.
- **Salt okunur**: `requireTenantUser({ write: true })` destek modunda reddeder; gelecekteki tüm panel mutasyonları bu bayrakla yazılacak.

## 13. Paketler (`src/config/plans.ts`)

`TenantPlan` = STARTER | PRO | AI (migration'da eski değerler veri korunarak yeniden adlandırıldı: PROFESSIONAL→PRO,
ENTERPRISE→AI). Özellik kontrolü daima `planHasFeature(plan, feature)` ile yapılır; `plan === "PRO"` gibi doğrudan karşılaştırma
yazılmaz. Faturalama geldiğinde etkin paket bir `Subscription` tablosundan türetilecek; özellik tablosu değişmeyecek.

## 14. Görseller (logo) — karar

Nesne depolama (R2/S3) henüz yapılandırılmadığından **görsel verisi PostgreSQL'e yazılmaz**. Bu sprintte logo yalnızca
`https://` URL olarak saklanır (`TenantSettings.logoUrl`, Zod ile doğrulanır; CSP `img-src https:`). Yükleme altyapısı
(imzalı URL ile doğrudan R2'ye yükleme + boyut/tür doğrulaması + görsel işleme) nesne depolama kurulduğunda eklenecek.

## 15. Denetim kataloğu

Eylemler `src/lib/audit/actions.ts`'te tiplidir (`AuditAction`); serbest string yazılamaz. `sanitizeAuditMetadata()` parola,
token, hash, oturum, cookie, authorization ve bağlantı dizesi gibi anahtarları **yazmadan önce** düşürür (testli emniyet ağı).
Çok adımlı değişikliklerde denetim satırları aynı transaction'da yazılır (iş geri alınırsa denetim de geri alınır).

## 16. Hydration ve Intl

Saat dilimi / para birimi / ülke listeleri Node ve tarayıcının ICU verisine göre farklılaşabildiğinden sunucuda
`getLocaleOptions()` ile üretilip istemci formlarına prop olarak verilir (aksi halde React #418 hydration hatası oluşur).

## 17. Yükleme durumları ve gerçek 404

`loading.tsx` yalnızca liste route group'larında (`(overview)`, `(list)`) bulunur. Kiracı/şube/talep id'si doğrulanan detay
rotalarının üstünde yükleme sınırı yoktur; böylece `notFound()` akış başlamadan çalışır ve gerçek 404 döner (soft-404 yok).

## 17b. Formlar: kullanıcı girdisi korunur

React 19, `<form action={fn}>` ile gönderilen formlarda eylem bitince kontrolsüz alanları sıfırlar — doğrulama hatasında bile.
Tüm Server Action formları `useFormAction` (`src/components/ui/use-form-action.ts`) ile `onSubmit` + `startTransition`
üzerinden gönderilir: hata durumunda yazılanlar korunur; "ekle" formları yalnızca başarıda (`resetOnSuccess`) temizlenir.

---

# Sprint 3 — Menü yönetimi

## 18. Veri modeli

```
MenuCategory ─┬─ MenuCategoryTranslation         (tek seviye iç içe: parentId → ana kategori)
              └─ Product ─┬─ ProductTranslation
                          ├─ ProductImage           (provider + key; görsel verisi DB'de YOK)
                          ├─ ProductVariant ── ProductVariantTranslation, BranchVariantPrice
                          ├─ ProductModifierGroup ── ModifierGroup ─┬─ ModifierGroupTranslation
                          │                                         └─ Modifier ── ModifierTranslation
                          ├─ ProductIngredient ── Ingredient ── IngredientTranslation
                          ├─ ProductAllergen ── Allergen ── AllergenTranslation       (tenantId null = platform standardı)
                          ├─ ProductDietaryTag ── DietaryTag ── DietaryTagTranslation (tenantId null = platform standardı)
                          └─ BranchProduct (şube farkı: satış / tükendi / fiyat)
```

Aynı model gelecekteki public QR menü, sipariş motoru ve AI asistan tarafından tüketilecek; ayrıca menü modeli yaratılmayacak.

**Kiracı izolasyonu veritabanında da zorunlu.** Kiracıya ait alt kayıtlar üst kayda **bileşik yabancı anahtarla** bağlanır:
`(productId, tenantId) → Product(id, tenantId)`, `(modifierGroupId, tenantId) → ModifierGroup(id, tenantId)`,
`(branchId, tenantId) → Branch(id, tenantId)` … Servis katmanı atlansa bile A kiracısının ürününe B'nin ekstra grubu,
malzemesi veya şubesi bağlanamaz (entegrasyon testi doğrudan yazmayı dener ve reddedildiğini doğrular). İstisnalar:
`parentId` (isteğe bağlı; servis + saf kural `validateCategoryParent`) ve platform alerjen/etiketleri (tenantId null; servis
"platform veya kendi kaydın" koşuluyla doğrular).

## 19. Para

Tüm tutarlar **tamsayı alt birim (kuruş)**: `basePriceMinor`, `priceMinor`, `priceDeltaMinor`. 89,90 TRY = 8990.
Kayan nokta yok; Prisma `Decimal` da kullanılmadı (istemciye serileştirme ve tamsayı aritmetiğinin sadeliği için).
Girdi `parsePriceToMinor` ("89,90" / "89.90"; binlik ayırıcı reddedilir), gösterim `formatMoney` (sunucuda) ve
`minorToInput` (Intl'siz, sunucu/tarayıcıda aynı). Ürünün para birimi `Product.currency`; şube ve varyant fiyatları aynı
para birimindedir. (2 ondalıklı para birimleri varsayılır; 0 ondalıklılar eklendiğinde ölçek para birimine göre okunacak.)

## 20. Fiyat çözümleme (`src/lib/menu/pricing.ts`)

```
Varyant yoksa:   şube ürün fiyatı → taban fiyat
Varyant varsa:   şube varyant fiyatı → varyantın kendi fiyatı → şube ürün fiyatı → taban fiyat
Ekstralar:       totalWithModifiers() — seçilen ekstraların priceDeltaMinor toplamı eklenir (≥ 0)
```

Görev tanımındaki sıra (şube varyant → şube ürün → varyant → taban) bilinçli olarak tek noktada yorumlandı: şube ürün
fiyatı ürünün **taban** fiyatını geçersiz kılar; kendi fiyatı olan varyantları (Küçük 50 / Büyük 70) tek fiyata ezmez.
Fiyatı boş varyantlar tabanı miras aldığı için şube ürün fiyatı onlara uygulanır. Sonuç `source` alanıyla döner
(panelde "Çözümlenmiş fiyatlar" tablosu bunu gösterir). Bileşenlerde fiyat hesabı yapılmaz.

## 21. Erişilebilirlik çözümleme (`src/lib/menu/availability.ts`)

`available` (görünür + sipariş edilebilir) · `sold_out` (görünür, sipariş edilemez) · `unavailable` (gizli). Sıra:
arşiv → pasif ürün → pasif kategori/üst kategori → pasif şube → şubede satılmıyor → seçili varyant pasif →
şube tükendi geçersiz kılması (yoksa ürünün genel tükendi değeri). Tipli sonuç `reason` içerir.

## 22. Çeviriler

Menü dilleri `tr, en, de, ar` (`src/config/menu.ts`). Ana satır kiracının varsayılan dilinin **kanonik** içeriğidir;
diğer diller `*Translation` tablolarında (ürün başına satır kopyası yok). Seçim `pickTranslated` / `translatedName`:
istenen dil → varsayılan dil; boş alanlar yok sayılır. Çeviri editörü Arapçayı `dir="rtl"` + `lang="ar"` ile gösterir;
düzen mantıksal hizalamaya (`text-start`) dayanır, public menü `direction` alanını alır. Platform alerjen/etiketlerinin
4 dilde çevirisi migration ile gelir (Arapça çeviriler yayından önce anadil kontrolünden geçmeli). AI çeviri sonraki sprint.

## 23. Arşiv (silme yok)

Ürün, varyant, ekstra grubu ve ekstra `archivedAt` ile arşivlenir; listelerden ve menüden kalkar, kayıt ve ilişkileri
kalır — gelecekteki sipariş satırları tarihsel olarak geçerli kalsın diye. Ürün arşivden çıkarılabilir. Toplu silme yok.
Kategoriler silinmez, pasifleştirilir. Silinebilen tek şey görsel *referansıdır* (harici dosya etkilenmez) ve
ürün ↔ grup / malzeme / alerjen bağlantılarıdır.

## 24. Görseller ve depolama (`src/lib/storage/`)

`StorageProvider` arayüzü: `publicUrl(key)`, `validateKey(key)`, `supportsUpload`. Bugün `external` (https URL; yerel/özel
ağ ve kimlik bilgili URL reddedilir, sunucu URL'ye istek atmaz). `ProductImage` `{ storageProvider, storageKey }` saklar —
Hetzner Object Storage eklendiğinde `HetznerStorageProvider` kaydedilir ve `ACTIVE_IMAGE_PROVIDER` değişir; eski kayıtlar
kendi sağlayıcılarıyla çözülmeye devam eder. Ürün başına en fazla 10 görsel, tek ana görsel, sıralama ve alternatif metin.

## 25. Yetki

`menu.view`: tüm işletme rolleri (garson/kasiyer/mutfak/bar menüyü salt okunur görür). `menu.manage`: İşletme Sahibi ve
Şube Müdürü. Her menü eylemi `requireTenantUser({ permission: "menu.manage", write: true })` — Super Admin destek modunda
menü görünür ama düzenlenemez. Salt okunur arayüz `<fieldset disabled>` ile; asıl karar her eylemde sunucuda.

## 26. Yayınlanmış menü servisi (`src/server/services/menu/public-menu.service.ts`)

`getPublishedMenu(scope, { branchId, locale })` — kategoriler (iç içe, boş olanlar atlanır), ürünler (çözülmüş fiyat,
erişilebilirlik, çeviri + yedek bayrağı, görseller, varyantlar, ekstra grupları, malzemeler, alerjen/etiket adları,
besin değerleri) ve `declaredByRestaurant: true` döner. SKU, kiracı kimliği, zaman damgaları, arşiv/pasif kayıtlar dönmez.
Sprint 4'te kiracı alan adından (`requireTenant`) public olarak sunulacak.

## 27. Bütünlük uyarıları

`productCompleteness` — görsel, açıklama, fiyat, alerjen bilgisi, dil başına çeviri. **Uyarıdır, yayını engellemez.**
"Alerjen yok" ile "girilmedi" ayrımı `allergensConfirmedAt` ile yapılır. Diyet/"Helal" gibi etiketler yalnızca işletmenin
açık beyanıyla atanır; sistem çıkarım yapmaz veya sertifika iddia etmez.

---

# Sprint 4 — Masalar, güvenli QR ve etiketler

## 28. Veri modeli

`DiningArea` (bölge) → `Branch`; `DiningTable` → `Branch` + isteğe bağlı `DiningArea`; `TableQrToken` → `DiningTable`.
Bağlar **bileşik yabancı anahtardır**: masa yalnızca `(areaId, branchId, tenantId)` üçlüsü eşleşen bölgeye, token yalnızca
`(tableId, branchId, tenantId)` eşleşen masaya bağlanabilir. A kiracısının masası B'nin bölgesine — ya da aynı kiracının başka
şubesinin bölgesine — uygulama katmanı atlansa bile taşınamaz (entegrasyon testi doğrudan dener).
Benzersizlik şube içindedir: bölge kısa adı, masa adı (servis ayrıca büyük/küçük harf duyarsız denetler), numara, iç kod.
Bölge ve masa silinmez; pasifleştirilir. Masanın şubesi oluşturulduktan sonra değişmez (QR geçmişi şubeye bağlı).

## 29. QR token mimarisi (`src/lib/tables/qr-token.ts`)

```
nonce     = 16 bayt CSPRNG (base64url)                 → DB (tek başına işe yaramaz)
token     = HMAC-SHA256(QR_TOKEN_SECRET, "v1:"+nonce)   → ilk 16 bayt = 128 bit, base64url, 22 karakter → URL
tokenHash = SHA-256(token)                              → DB, benzersiz indeks (arama anahtarı)
```

- Public adres: `https://<kiracı alan adı>/t/<token>`. Masa numarası / kimliği URL'de yoktur; numara yalnızca görüntü verisidir.
- Düz token saklanmaz ve loglanmaz. Veritabanı sızıntısı tek başına geçerli adres üretmeye yetmez (sır gerekir).
- Neden "yalnızca bir kez göster" değil? İşletme aynı QR'ı aylar sonra yeniden basabilmeli. Yetkili kullanıcı için token
  nonce + sırdan **yeniden türetilir** ve saklanan özetle karşılaştırılır; eşleşmezse (sır değişmiş) yanlış QR basılmaz,
  "QR'ı yenileyin" denir. Sır değişse bile basılı QR'lar çalışmaya devam eder (arama özetle yapılır).
- Alan adı: birincil alan adı (alt alan ya da **doğrulanmış** özel alan adı). Kiracı kısa adı/alt alan adı taşınırsa
  basılı QR'lar eski alan adını gösterir — **Sprint 5'te çözüldü**: etiketler artık kararlı /q/ adresini kodlar (§35).

## 30. Çözümleme (`resolveTableQrToken`) — gelecekteki QR menü ve sipariş bunu kullanır

Kiracı **istek host'undan** (resolveTenantByHost), masa token'dan gelir. Sıra: host kiracı mı / askıda mı → token biçimi
(biçimsizse DB'ye gidilmez) → özetle tekil sorgu → token'ın kiracısı = host kiracısı mı → iptal / süre → şube, masa, bölge aktif mi.
Tüm retler public sayfada aynı nötr 404'e düşer (neden sızdırılmaz). `getTableQrContext(token)` (React cache) güvenilir bağlamı
ve `TenantScope`'u verir; sayfa HTML'ine iç kimlik yazılmaz, sayfa `noindex` + `referrer: no-referrer`.

Okutma: `scanCount` + `lastUsedAt` yanıttan sonra (`after()`) artırılır; yalnızca etkin token. Olay bazlı geçmiş
(`QrScanEvent`) bilinçli olarak YOK — kişisel veri (IP, cihaz) toplamadan toplam sayı yeterli; analitik gerekirse
anonim, günlük toplu tablo eklenmeli.

## 31. Yenileme / iptal

Masa satırı `SELECT … FOR UPDATE` ile kilitlenir (eşzamanlı yenilemede iki etkin token oluşmaz). Yenile = etkin token'ları
aynı transaction'da iptal et + yeni satır; eski adres anında 404. İptal edilen token asla yeniden etkinleşmez; satırlar
denetim için kalır (masa sayfasında "QR geçmişi"). Toplu masa oluşturma şube satırını kilitler; çakışma varsa hiçbir masa oluşmaz.

## 32. Etiket üretimi (`src/server/labels/`)

Tek çizim modeli → iki çıktı: `buildLabel()` şablondan bağımsız bir çizim listesi (dolgulu vektör yollar + logo görseli) üretir;
`renderLabelSvg` ve `renderLabelPdf` / `renderSheetPdf` (pdf-lib) aynı listeyi çizer. Önizleme sunucuda çizilen gerçek SVG'dir —
önizleme, SVG ve PDF birebir aynı. Ekran görüntüsü / html2canvas yok.

- Ölçüler milimetre; PDF'te 1 mm = 72/25,4 pt. Tek etiket PDF'i: sayfa = etiket + taşma payı, `TrimBox`/`BleedBox` ayarlı.
- Metin yazı tipinden bağımsız olsun diye **yola çevrilir** (opentype.js; Inter + Playfair Display, SIL OFL, `assets/fonts`).
- QR: `qrcode` ile yerel üretim, hata düzeltme **H**, 4 modül sessiz bölge, modüller vektör yol. Kaynak: yalnızca public adres.
- QR en az 20 mm hedeflenir; küçük etiketlerde isteğe bağlı satırlar (bilgi, başlık, imza) sırayla gizlenir ve uyarı verilir.
- Renk güvenliği (`src/lib/tables/contrast.ts`): QR marka rengiyle yalnızca koyu modül açık zeminden koyuysa ve kontrast
  ≥ 7:1 ise basılır; aksi halde otomatik siyah/beyaz + uyarı. Metin renkleri ≥ 4,5:1'e zorlanır. Koyu şablonda QR beyaz plaka üzerinde.
- Logo: sunucu indirir (yalnızca https, IP/özel ağ reddi, yönlendirme yok, 4 sn, 2 MB, PNG/JPEG imzası). 300 DPI için düşük
  çözünürlükte uyarı. SVG logo ve Latin dışı (ör. Arapça) işletme adları etikette desteklenmez.
- A4 toplu sayfa: 8 mm kenar payı, 6 mm aralık, ızgara ortalanır, köşelere kesim işareti; taşma payı uygulanmaz.
  Etiket **asla ölçeklenmez** — sığmıyorsa indirme kapanır, verimsizse (kâğıdın < %40'ı) açık uyarı.

## 33. Yetki

`tables.view`: sahip, şube müdürü, garson, kasiyer (salt okunur liste; QR adresi/görseli gösterilmez).
`tables.manage`: sahip, şube müdürü. Mutfak/bar erişemez. Token içeren her uç (QR indirme, etiket önizleme/indirme,
A4 sayfa) `requireTenantUser({ permission: "tables.manage", write: true })` ister — Super Admin destek modunda QR
görüntülenmez/oluşturulamaz; Super Admin işletme detayında yalnızca sayıları görür. A4 uç noktası (POST Route Handler)
Server Action CSRF korumasını almadığından `Origin` başlığını doğrular.
Şube müdürü mevcut modelde kiracının tüm şubelerini yönetir (kullanıcı–şube ataması Personel modülüyle gelecek).

## 34. Denetim

`DINING_AREA_CREATED/UPDATED`, `TABLE_CREATED/UPDATED/BULK_CREATED`, `TABLE_QR_CREATED/REGENERATED/REVOKED`,
`LABEL_PDF_GENERATED`. Metadata'da token, özet ve nonce yoktur (entegrasyon ve e2e testleri denetler).

---

# Sprint 5 — Kararlı QR girişi + müşteri QR menüsü

## 35. Kararlı QR girişi (`src/lib/domain/qr-entry.ts`, `src/lib/tables/resolve-stable-entry.ts`)

Basılı etiket yıllarca masada kalır; kiracının kısa adı / alt alan adı / özel alan adı değişebilir. Bu yüzden etiket
artık kiracı alan adını değil platformun değişmeyen giriş adresini kodlar:

```
<QR_ENTRY_ORIGIN>/q/<token>   ──307 (önbelleksiz)──▶   https://<kiracının O ANKİ alan adı>/t/<token>
```

- `QR_ENTRY_ORIGIN` (sunucu ortam değişkeni, ör. `https://go.masanovai.com`); boşsa `NEXT_PUBLIC_APP_URL`. Üretimde https
  zorunlu; yalnızca origin. `go`, `qr`, `q` alt alanları kiracılara verilemez (ayrılmış). `proxy.ts` ayrı giriş host'unda
  yalnızca `/q/*` sunar, gerisini platforma yönlendirir.
- **Kanonik adres** (etiket, QR PNG/SVG, PDF, A4 sayfa): `/q/<token>`. Panel ayrıca o anki doğrudan adresi bilgi olarak gösterir.
- Yönlendirme hedefi her istekte yeniden hesaplanır: birincil kayıt (alt alan ya da **doğrulanmış** özel alan), yoksa
  alt alan adı. Doğrulanmamış özel alana asla gidilmez. Kalıcı (301/308) yönlendirme KULLANILMAZ — alan adı
  tarayıcı önbelleğine "basılmasın".
- **Dar kapsamlı çözümleyici**: yalnızca token durumu (aktif/iptal/süre), masa/bölge/şube aktifliği, kiracı durumu ve
  yayın alan adları okunur. Masa/şube adı, kimlikler DÖNMEZ. Masa bağlamı yalnızca yönlendirilen kiracı host'unda,
  host'a bağlı `resolveTableQrToken` ile kurulur (tüm kontroller orada yeniden yapılır; Sprint 4 kuralı zayıflatılmadı).
- **Sayım (enumeration) önlemi**: tüm başarısızlıklar aynı nötr 404 sayfası; biçimsiz değer veritabanına gitmez;
  128 bit token; IP başına 60 istek/dk sınır (bellek içi — çoklu örnekte Redis'e taşınmalı). Token loglanmaz.

**Geriye uyumluluk**: token'lar değişmedi, yeniden üretim gerekmez. Sprint 4'te basılmış doğrudan
`https://<alt-alan>/t/<token>` adresleri o alan adı yayında olduğu sürece çalışmaya devam eder; yeni basımlar kararlı
adresi kullanır. Alan adı değişikliğinde eski doğrudan etiketler çalışmaz — bunlar yeniden basılmalıdır (kararlı
etiketler etkilenmez).

## 36. Okutma sayımı (`src/lib/tables/scan-count.ts`)

Kanonik olay: kiracı alan adındaki `/t/<token>` sayfasının **belge** olarak açılması (`after()` ile yanıttan sonra).
`/q` saymaz → kararlı QR (iki istek) ve eski doğrudan QR (tek istek) ikisi de tam **1** sayım. RSC gezinmesi (dil
değişimi), prefetch / prerender sayılmaz. Bilinen sınır: sayfanın elle yenilenmesi yeni belge isteğidir ve sayılır
(kişisel veri tutmadan ayırt edilemez).

## 37. Public menü mimarisi

```
/t/<token>  (Server Component)
  getTableQrContext(token)            ← canlı, önbelleksiz: kiracı host'tan, masa token'dan
  getCachedPublicPresentation(scope)  ← önbellekli: ad, logo, renkler, PublicMenuSettings
  pickPublicLocale(?dil, çerez, varsayılan)
  getCachedPublishedMenu(scope, şube, dil)  ← önbellekli: merkezi fiyat + erişilebilirlik çözümleyicileri
  toPublicMenuView(...)               ← TEK serileştirme noktası (küçültülmüş sözleşme)
  <PublicMenu view />                 ← tek istemci bileşeni (arama/filtre yüklenmiş veride, ağ isteği yok)
```

- **Sözleşme** (`src/lib/public-menu/types.ts`): iç kimlik, SKU, kiracı/şube/masa kimliği YOK; ürün anahtarı kısa ad.
  Fiyatlar sunucuda çözümlenip **biçimlenmiş metin** olarak gelir; React bileşenleri fiyat hesaplamaz (onaylı öncelik:
  şube varyant → varyant → şube ürün → taban; değiştirilmedi).
- Gizli (şubede satılmayan), pasif, arşivli ürün/kategori yükte hiç yoktur; tükenen görünür + "Tükendi" (sipariş
  edilebilir izlenimi yok). Görünürlük kapatılan alanlar (alerjen, içindekiler, besin, süre) yükten çıkarılır
  (`applyVisibility`, önizlemeyle ortak). Alerjenler gizliyse ürünler "bilgi yok" sayılır.
- Yönetim paneli kodu import edilmez; yalnızca `src/components/public/*` + saf `src/lib/public-menu/*`.
- Görseller düz `<img>`: tembel yükleme, sabit oran, `no-referrer` (token'lı adres dış sunuculara sızmasın), hata
  durumunda kaldırılır (kırık görsel simgesi yok). Yalnızca kapak ve ilk kartlar öncelikli.

## 38. Önbellek (`src/server/services/public-menu/public-menu-cache.ts`)

`unstable_cache` — anahtar `["public-menu", tenantId, branchId, locale]`, etiket `public-menu:<tenantId>`, 5 dk emniyet
süresi. Anahtar yalnızca güvenilir kapsamdan üretilir; iki kiracı aynı girdiyi paylaşamaz (birim testli).
Geçersiz kılma: menü eylemleri, Tema & Tasarım, Super Admin marka/genel/şube güncellemeleri → `updateTag` (anında).
Doğrudan veritabanı düzenlemeleri (betik, SQL) önbelleği geçersiz kılmaz — en fazla 5 dk gecikir.
Önbelleğe alınmayan: token doğrulama, masa/bölge/şube aktifliği, kiracı durumu (her istekte canlı).
QR sayfaları paylaşılan HTTP önbelleğine girmez (dinamik, `no-store`), `noindex, noarchive`, sitemap'te yok;
PWA eklenirse token'lı sayfalar service worker önbelleğine ALINMAMALI.

## 39. Tema sistemi (`src/lib/public-menu/theme.ts`)

`PublicMenuSettings` (kiracı başına tek satır; yoksa varsayılanlar): düzen `COMPACT | VISUAL | LUXURY`, karşılama
metni (düz metin, 160), kapak görseli (https, harici URL kuralları), görünürlük anahtarları, imza. Marka renkleri ve
logo `TenantSettings`'te kalır (panel ve etiketlerle ortak). `resolvePublicTheme` hem sunucuda hem paneldeki canlı
önizlemede çalışır; marka rengi üzerindeki metin ve vurgu metni ≥ 4,5:1'e zorlanır. Serbest CSS/HTML/JS yok.
Yerleşim **kapsayıcı sorgularıyla** (`@container`) duyarlıdır — panel önizlemesi gerçek telefon genişliğinde davranır.
Önizleme gerçek yayınlanmış menüyü gösterir ama masa bağlamı uydurmaz ("Önizleme" rozeti). Destek modunda salt okunur.

## 40. Dil / RTL / erişilebilirlik

Dil: `?dil=` → cihaz çerezi `mn_dil` (yalnızca dil kodu; izleme yok) → kiracı varsayılanı; yönlendirme yapılmaz.
İçerik çevirisi yoksa varsayılan dil (boş/undefined asla). Arapça: kök öğede `dir="rtl"` + `lang="ar"`, mantıksal CSS
(`ps/pe/start/end`), detay ve filtre pencereleri de RTL. Arapça arayüz metinleri örnek çeviridir (anadil kontrolü gerekir).
Fiyatlar Arapçada da `₺380,00` biçimindedir. Dokunma hedefleri ≥ 44 px, `<dialog>` ile odak yönetimi, ürün kartı
`<article>` + başlık içi geniş düğme, `prefers-reduced-motion` desteklenir. Alerjen/diyet ifadeleri tıbbi garanti vermez.

## 41. Analitik temeli (`src/lib/public-menu/events.ts`)

Tipli olaylar (`menu_opened`, `category_viewed`, `product_opened`, `search_used`, `language_changed`) yalnızca tarayıcı içi
olay olarak yayınlanır; kalıcı kayıt bilinçli olarak ertelendi. Kişisel veri, çerez, arama metni gönderilmez.

---

# Sprint 6 — Sepet, masa siparişi, sipariş motoru temeli

## 42. Güven sınırı

Tarayıcı YALNIZCA seçim gönderir: ürün kısa adı, opak varyant / ekstra grubu / ekstra referansları, adet, notlar ve
"gördüğü birim fiyat" (yalnızca karşılaştırma için). Fiyat, toplam, kiracı / şube / masa / token, kullanılabilirlik
istemciden ASLA alınmaz (Zod şeması bilinmeyen alanları atar). Masa bağlamı her çağrıda QR token + istek host'undan
yeniden kurulur (`getTableQrContext`).

**Opak referanslar** (`src/server/services/orders/menu-refs.ts`): public menüye veritabanı kimliği yerine
`HMAC(QR_TOKEN_SECRET, "menu-ref:" + tenantId + ":" + id)[0..12]` gider. Sunucu gönderimde ürünün KENDİ varyant /
grup / ekstralarının referanslarını yeniden hesaplayıp eşler — başka kiracının / başka ürünün kaydı seçilemez,
kimlik sızmaz.

## 43. Merkezi hesaplayıcı (`src/lib/orders/calculate.ts`)

Tek saf motor: `calculateOrder(catalog, items, { checkExpectedPrice })`. Katalog fiyatları zaten merkezi fiyat
çözümleyicisinden geçmiştir (onaylı öncelik değişmedi: şube varyant → varyant → şube ürün → taban). Kurallar:
varyantlı üründe varyant zorunlu (sunucu varsayılanı kendisi seçmez), grup ürüne bağlı olmalı, ekstra o gruba ait
olmalı, tekrar yok, zorunlu grup ≥ max(1, min), ≤ max; adet 1–20, satır ≤ 30, toplam adet ≤ 100; tek para birimi.
Vergi / servis ücreti yok — toplam = ara toplam. İstemci aynı fonksiyonla canlı fiyat önizlemesi yapar (yetkili değil);
sunucu gönderimde **yetkili katalogu** (`loadOrderCatalog`, önbelleksiz, veritabanı) kullanır. Public menü önbelleği
(Sprint 5) yalnızca göz atma içindir; sipariş doğrulaması asla önbellekten okumaz. İleride garson / POS / AI siparişleri
aynı motoru kullanır.

## 44. Gönderim (`src/server/services/orders/submit-order.service.ts`)

1. Tekrar koruması: `(tenant_id, SHA-256(anahtar))` benzersiz. Aynı anahtar + aynı içerik → mevcut sipariş döner
   ("duplicate"); aynı anahtar + farklı içerik → ret. İçerik özeti: masa + kalemler (ekstralar sıralı) + not
   (beklenen fiyat hariç). İstemci anahtarı onay adımına girerken üretir; ağ hatasında aynı anahtarla yeniden dener.
2. Tek transaction: bağlam YENİDEN doğrulanır (token etkin, masa / bölge / şube aktif, kiracı TRIAL/ACTIVE) →
   yetkili katalog → hesap. Uyuşmazlık (fiyat değişti, tükendi, artık yok, geçersiz seçim) → hiçbir şey yazılmaz,
   satır bazlı **mutabakat** döner. Müşteri yeni tutarı açıkça kabul edip yeniden gönderir; ürün seçimi asla sessizce
   değiştirilmez.
3. Şube sayacı: `INSERT … ON CONFLICT (branch_id) DO UPDATE SET last_number = last_number + 1 RETURNING` → satır kilidi
   yalnızca o şubenin sipariş transaction'ı boyunca (menü / diğer şubeler kilitlenmez). Numaralar şube içinde 1001'den
   artar, sıfırlanmaz, yeniden kullanılmaz (`#1042`). İç kimlik müşteriye gösterilmez.
4. Sipariş + kalemler + ekstralar + ilk durum geçmişi + denetim kaydı aynı transaction'da; hata → hiçbir satır kalmaz.
5. Eşzamanlı aynı anahtar → benzersiz kısıt ihlali → mevcut sipariş döner (testte 6 eşzamanlı istek → 1 sipariş).

Eşzamanlılık: kilitlenmeyen menü okumaları READ COMMITTED; gönderim sırasında tükenen ürün o anki okumaya göre
değerlendirilir (milisaniyelik pencere bilinçli kabul — menüyü kilitlemek tüm restoranı yavaşlatırdı).

## 45. Değişmez kopyalar

`Order` (masa / bölge / şube adı, para birimi, toplamlar, dil, not), `OrderItem` (müşteri dilindeki ürün adı +
varsayılan dildeki ad, varyant adı, çözülmüş birim fiyat, ekstra toplamı, birim, adet, satır toplamı, not),
`OrderItemModifier` (grup adı, ekstra adı, fiyat farkı). Görüntüleme yalnızca bunlardan yapılır; canlı ürün / ekstraya
giden FK'ler yalnızca analitik içindir (ürün yeniden adlandırılsa / fiyatı değişse / ekstra arşivlense de sipariş aynı
— entegrasyon testli). Varyant / ekstra adları işletmenin varsayılan dilinde kopyalanır (mutfak / personel).

## 46. Müşteri erişimi

Hesap yok. Sipariş sayfası `/t/<token>/siparis/<publicId>`: public kimlik 128 bit (tahmin edilemez) ama tek başına
yetki DEĞİLDİR — sipariş yalnızca güvenilir QR bağlamının kiracısı VE masası eşleşirse ve son 24 saat içindeyse açılır;
aksi halde nötr 404. Başka masanın / kiracının QR'ı ile açılmaz. Token yenilense de sipariş masaya bağlı kalır.
Aynı masadaki diğer kişiler (aynı QR) public kimliği bilirse görebilir — masa paylaşımlı bir bağlamdır.

**Sepet**: localStorage (hesap / kişisel veri yok), masa başına ayrı anahtar (`mn_cart:<opak kapsam>`); kapsam masa
kimliğinin HMAC'idir, yetki değildir. Okunan sepet güvenilmez girdi olarak doğrulanır; 6 saat dokunulmazsa düşer.
Başka masanın sepeti otomatik aktarılmaz: "Bu sepet farklı bir masaya ait." (dön / temizle). Satır anahtarı
ürün + varyant + sıralı ekstralar + not → aynı yapılandırma birleşir, farklı not / ekstra ayrı satır.

## 47. Durum makinesi (`src/lib/orders/status.ts`)

`SUBMITTED → ACCEPTED | REJECTED`, `ACCEPTED → PREPARING | READY | CANCELLED`, `PREPARING → READY | CANCELLED`,
`READY → SERVED`; geri dönüş yok, terminal: SERVED / REJECTED / CANCELLED. Personel geçişleri (`STAFF_TRANSITIONS`):
kabul / ret (`orders.manage`), servis (`orders.serve`), iptal (`orders.cancel`, açıklama zorunlu). PREPARING / READY
yalnızca sistem tarafından fişlerden türetilir (`SYSTEM_TRANSITIONS`, `deriveOrderStatus`). Güncelleme "beklenen önceki
durum" koşuluyla; her geçiş `OrderStatusHistory` (STAFF / SYSTEM aktör) + denetim. Ret açıklaması müşteriye gösterilir;
iptal nedeni gösterilmez (iç not olabilir).

## 48. Yetki, hız sınırı, gizlilik

`orders.view`: tüm kiracı rolleri. `orders.manage` (kabul / ret): sahip, şube müdürü, garson, kasiyer. `orders.serve`:
sahip, müdür, garson. `orders.cancel` ve `stations.manage`: sahip, müdür. `kds.view` / `kds.manage`: sahip, müdür, mutfak, bar. Kullanıcı–şube ataması olmadığından liste kiracı genelidir. Destek modunda karar verilemez.
Hız sınırı katmanlı (bellek içi, `RateLimiter` arayüzü Redis'e taşınabilir): IP+masa 8 / 10 dk, masa 30 / 10 dk,
IP 120 / 10 dk (aynı Wi-Fi'deki masalar normal kullanımda takılmaz). Müşteri gönderiminin denetim kaydında IP /
tarayıcı bilgisi TUTULMAZ; token, tekrar anahtarı, public kimlik loglanmaz. Notlar düz metin (kontrol / yön işaretleri
atılır, ürün notu 140, sipariş notu 300 karakter), HTML olarak yorumlanmaz.

# Sprint 7 — Gerçek zamanlı siparişler, KDS, istasyon yönlendirme

## 49. Gerçek zamanlı mimari (`src/server/realtime/*`, `src/lib/realtime/events.ts`)

Tek yönlü sunucu → istemci akışı için **Server-Sent Events** (WebSocket gerekmiyor; vekil / CDN dostu, tarayıcı yerleşik).
`RealtimeProvider` arayüzü (`publish` / `subscribe` / `listenerCount`); şimdiki uygulama tek süreç **bellek içi**
(globalThis `Symbol.for` tek örnek). Birden çok süreç / sunucuya ölçeklemede aynı arayüzle Redis Pub/Sub (ya da yönetilen
sağlayıcı) takılır — servisler ve SSE uçları değişmez. **Bilinen sınır:** çok süreçli dağıtımda bellek içi sağlayıcı
olayları süreçler arasında taşımaz; istemcilerin yeniden bağlanınca / 30 sn yedek yenilemede yetkili durumu çekmesi
doğruluğu korur, yalnızca gecikme artar.

Zarf (`version: 1`, `type`, `occurredAt`, `data`). Tipler: ORDER_SUBMITTED / ACCEPTED / REJECTED / PREPARING / READY /
SERVED / CANCELLED, STATION_TICKET_UPDATED. Olay **"değişti" sinyalidir**: istemci yetkili veriyi sunucudan yeniden çeker
(`router.refresh`) — olaylar yeniden oynatılmaz, kaçırılan olay yeniden bağlanmada tam yenilemeyle telafi edilir. Olaylar
yalnızca **transaction commit edildikten sonra** yayınlanır (`PendingEvent[]` toplanır → `flushEvents`); geri alınan işlem
olay üretmez.

Kanallar yalnızca sunucuda üretilir: `tenant:<id>:orders` (personel) ve `order:<id>` (müşteri). Personel verisi:
orderId, orderNumber, status (+ fiş: ticketId, stationId). Müşteri verisi: **yalnızca status** (kimlik, personel adı, iç not,
fiyat yok). QR token, public kimlik, oturum, kiracı sırrı hiçbir olayda yok.

SSE yanıtı (`createSseResponse`): `text/event-stream`, `Cache-Control: no-cache, no-store, no-transform`,
`X-Accel-Buffering: no`, `retry: 3000`; 25 sn'de bir yorum satırı heartbeat; her heartbeat'te `stillAuthorized()`;
istemci ayrılınca (abort) abonelik + zamanlayıcılar temizlenir; `maxLifetimeMs` ile periyodik kapanış (istemci yeniden
bağlanıp yetkiyi tazeler). İstemci (`useRealtimeStream`): denetimli üstel geri çekilme 1 → 30 sn (±%20), bileşen
kaldırılınca kapanır, durum: connecting / live / reconnecting.

## 50. Akış güvenliği (`src/server/realtime/authorize.ts`)

- **Panel** `/panel/olaylar`: `requireTenantUser` kapısı (kiracı erişilebilir, host eşleşmesi; destek modu salt okunur izleyebilir)
  + `orders.view` ya da `kds.view`. Heartbeat'te oturum veritabanından yeniden doğrulanır: çıkış / süre / pasif kullanıcı /
  rol / kiracı askıya alma / destek modu bitişi → akış kapanır. Oturumsuz → 403.
- **Müşteri** `/t/<token>/siparis/<publicId>/akis` (kiracı alan adı): sipariş sayfasıyla aynı kural — `getTableQrContext` +
  aynı kiracı + aynı masa + 24 saat (`findPublicOrderStreamRef`). Eşleşmezse nötr 404. Akış erişim penceresi dolunca, QR
  iptal / pasifleşince ya da masa pasifleşince kapanır.

## 51. İstasyonlar (`PreparationStation`, `src/server/services/kds/station.service.ts`)

Şube başına istasyon (KITCHEN / BAR / DESSERT / COLD / GRILL / CUSTOM), şube içinde ad benzersiz, silinmez — pasifleştirilir.
**Varsayılan**: `branches.default_station_id` (tek kolon → şube başına en fazla bir). Bileşik FK
`(default_station_id, default_station_branch_id, tenant_id) → preparation_stations(id, branch_id, tenant_id)` +
CHECK `default_station_branch_id = id` → başka şubenin / kiracının istasyonu varsayılan olamaz. (İlk sürüm FK'yi
`branches.id` üzerinden kuruyordu; Prisma checked create'te `id` varsayılanını üretmediği için ayrı kolona taşındı —
migration `20261014010000`.) Pasifleştirme varsayılanı kaldırır; pasif istasyon varsayılan yapılamaz. Denetim:
STATION_CREATED / STATION_UPDATED / STATION_DEACTIVATED.

## 52. Ürün yönlendirmesi (`ProductPreparationStation`, `src/lib/orders/routing.ts`)

Ürün → istasyon ataması **şube başına** (aynı ürün Merkez'de Bar'a, başka şubede Mutfak'a gidebilir); FK istasyonun aynı
şube + kiracıya ait olmasını zorlar. Kabulde her kalem: aktif atamaları (birden fazla olabilir → her birine fiş) → yoksa
aktif varsayılan → yoksa **yönlendirilemedi**. Yönlendirilemeyen kalem varsa sipariş kabul edilmez: "N ürün için
hazırlama istasyonu tanımlanmamış (…)". Ekstralar ayrı fiş oluşturmaz. Denetim: PRODUCT_STATIONS_UPDATED. Arayüz:
Menü › Ürün › İstasyonlar.

## 53. Fişler (`OrderTicket`, `OrderTicketItem`)

Kabul transaction'ında (koşullu ACCEPTED güncellemesiyle aynı işlemde) istasyon başına bir fiş (`@@unique(orderId, stationId)`)
ve kalem bağlantıları üretilir. Fiş istasyon adını / tipini **kopyalar** (istasyon sonradan yeniden adlandırılsa da geçmiş
fiş değişmez); içerik sipariş kalemi kopyalarından okunur. Ret fiş üretmez. Fiş durumları PENDING → PREPARING → READY;
CANCELLED yalnızca sipariş iptaliyle. Denetim: TICKET_PREPARING / TICKET_READY.

## 54. Otomatik sipariş durumu (`transitionTicket`)

Fiş geçişi sipariş satırını `SELECT … FOR UPDATE` ile kilitler, fişi koşullu günceller, tüm fişleri okuyup
`deriveOrderStatus` uygular: ilk başlayan fiş → PREPARING; iptal olmayan **tüm** fişler READY → READY (bir istasyonun
bitmesi yetmez). ACCEPTED'tan doğrudan tümü hazırsa önce PREPARING sonra READY yazılır (tutarlı zaman çizelgesi).
Geçmiş aktörü SYSTEM, denetim ORDER_PREPARING / ORDER_READY (`automatic: true`). Kilit sayesinde iki istasyon aynı anda
"Hazır" dediğinde READY **tek kez** yazılır ve yayınlanır.

## 55. KDS (`/panel/mutfak`, `src/components/kds/kds-board.tsx`)

İstasyon seçimi (bu cihazda localStorage; "Tüm istasyonlar"), sütunlar Yeni / Hazırlanıyor / Hazır (hazır fişler servis
edilene kadar, en fazla 3 saat). Büyük kartlar: sipariş no, masa, bölge, geçen süre, kalemler, varyant, ekstralar, kalem /
sipariş notu; fiyat yok. Aciliyet 10 dk uyarı / 20 dk kritik ("Gecikti"). "Ses Bildirimlerini Aç" (kullanıcı hareketiyle
AudioContext; yalnızca seçili istasyondaki yeni fişte), "Tam Ekran", "Ekranı Açık Tut" (Wake Lock, destekleyen tarayıcıda;
görünürlükte yeniden alınır). Bağlantı göstergesi "Canlı" / "Bağlantı yeniden kuruluyor". 48px dokunma hedefleri.
İstasyon ayarları: `/panel/mutfak/istasyonlar` (görüntüleme kds.view, değiştirme stations.manage).

## 56. Panel ve müşteri canlı durumu

`/panel/siparisler` ve sipariş detayı `LiveRefresh` ile güncellenir (olaylar 250 ms'de tek yenilemeye toplanır). Detay:
istasyon fişleri, zaman çizelgesi (Sistem (mutfak fişleri) aktörü), Servis edildi (orders.serve) ve İptal et (orders.cancel,
neden zorunlu). Müşteri sipariş sayfası (`OrderLiveStatus`): SSE + geri çekilme, bağlantı yokken 30 sn yedek yenileme,
terminal durumda akış açılmaz; kesinti göstergesi yalnızca 3 sn'yi aşarsa görünür (CSS gecikmesi). "Siparişiniz hazır"
vurgulu; tr / en / de / ar metinleri; Arapça sayı uyumu `Intl.PluralRules("ar")` ile (منتج واحد / منتجان / 3 منتجات / 11 منتجًا).

# Sprint 8 — Masa servis talepleri ve ön salon panosu

## 57. Veri modeli (`TableServiceRequest`, `TableServiceRequestStatusHistory`)

Tipler (enum, serbest metin değil): WAITER, WATER, NAPKIN, BILL, CUSTOM (yalnızca CUSTOM kısa düz metin not taşır,
≤160, CHECK). Durumlar: OPEN → ACKNOWLEDGED → COMPLETED; OPEN | ACKNOWLEDGED → CANCELLED (`src/lib/service-requests/status.ts`
tek kaynak; durum doğrudan atanmaz). Kiracı / şube / masa / bölge / QR token bileşik FK'lerle bağlı; şube, bölge, masa
adları oluşturma anında kopyalanır (yeniden adlandırma geçmişi bozmaz). `publicId` 16 bayt base64url (iç kimlik dışarı
çıkmaz). Personel adı güvenli biçimde kopyalanır (`acknowledgedByName` = "Merve K."; e-posta yok); kullanıcı FK'si yok
(personel silinse de geçmiş kalır). `relatedOrderId` isteğe bağlı: hesap talebinde müşterinin bu cihazda verdiği
siparişlerden AYNI kiracı + masa + 24 saat içinde doğrulanan en yenisi — tahmin yok, sipariş zorunlu değil.
Geçmiş tablosu her geçişi aktör tipi (CUSTOMER / STAFF) ve kullanıcıyla tutar (yanıt süresi, saatlik dağılım, personel
performansı analitiğinin temeli; sıralama / oyunlaştırma yok). Talepler silinmez; gece sıfırlanmaz.

## 58. Mükerrer koruma (`src/lib/service-requests/duplicate.ts`)

Masa + tip başına tek AKTİF talep (su / peçete dahil — öngörülebilir davranış). Veritabanı garantisi: `active_slot`
yalnızca aktifken `'ACTIVE'`, `@@unique([tableId, type, activeSlot])` (NULL'lar çakışmaz) + CHECK (durumla tutarlılık).
Servis önce mevcut aktif talebi arar (hızlı yol); yarışta benzersizlik ihlali (P2002) yakalanır ve kazanan talep döner
→ müşteri "… zaten iletildi" görür. Tamamlanan / iptal edilen talep yuvayı boşaltır; yenisi açılabilir.
Hız sınırı (bellek içi, Redis'e taşınabilir): masa + tip 6 / 10 dk, masa 20 / 10 dk, IP 120 / 10 dk (IP ikincil).

## 59. Müşteri akışı

`submitServiceRequestAction(token, …)`: bağlam her çağrıda `getTableQrContext` (iptal / pasif QR, masa, bölge, şube ya
da askıdaki kiracı → nötr `context_invalid`). Tarayıcının kiracı / şube / masa alanları şemada yok. QR menüsünde
"Servis" düğmesi (sepet çubuğunun yanında) → alttan sayfa: 5 büyük düğme → onay ("Hesap istemek istediğinize emin
misiniz?") → sonuç. Hesap talebi ödeme değildir. Müşteri yalnızca OPEN talebini geri alabilir (aynı masa bağlamı).
Ad / telefon / e-posta istenmez; denetimde IP / tarayıcı / token tutulmaz. tr / en / de / ar (`i18n-service.ts`), RTL.

## 60. Gerçek zamanlı

Olaylar: SERVICE_REQUEST_CREATED / ACKNOWLEDGED / COMPLETED / CANCELLED (zarf v1, commit sonrası). Personel kanalı
`tenant:<id>:orders` (talep kimliği + tip + durum); müşteri için **masa kanalı** `table:<tableId>` → `/t/<token>/akis`
(yalnızca tip + durum; kimlik / ad / not yok). Masa akışı yalnızca aktif talep varken açılır (talep başına bağlantı yok);
olay "değişti" sinyalidir, durum `listServiceRequestsAction` ile yeniden çekilir; bağlantı yoksa 30 sn yedek yenileme.
Sipariş listesi ve KDS servis olaylarını yok sayar; servis panosu yalnızca servis olaylarıyla yenilenir.

## 61. Servis panosu (`/panel/servis`, `/panel/servis/gecmis`)

Sütunlar Bekliyor / İlgileniliyor / Tamamlandı (masaüstü); telefon / tablet (<1024) sekmeli tek sütun, 48px+ hedefler.
Kart: masa, bölge, tip, bekleme süresi (3 dk uyarı, 7 dk kritik — varsayılan), not, saat, ilgilenen, ilgili sipariş no.
Metrikler tek SQL sorgusunda: bekleyen, ilgilenilen, bugün tamamlanan, ortalama yanıt (üstlenme − oluşturma); "bugün"
şube (filtre varsa) ya da işletme saat diliminde (`zonedDayBounds`, yaz saati dahil). Veri yoksa "—" (uydurma yok).
Filtreler: şube, bölge, tip, masa adı, "yalnızca benim". Aktif talepler eskise de düşmez (otomatik tamamlama yok).
Geçmiş: kapanan talepler, sunucu sayfalaması, yanıt / tamamlanma süreleri. Zil sesi (üç nota, mutfaktan ayırt edilir;
kullanıcı açar, cihazda hatırlanır), tam ekran. Masa detayında açık / son talepler + 30 günlük ortalama yanıt;
genel bakışta açık talep sayısı + bugünkü ortalama yanıt.

## 62. Roller ve atama

`service.view`: sahip, müdür, garson, kasiyer. `service.manage` (tüm tipler): sahip, müdür, garson. `service.bill`:
kasiyer — yalnızca HESAP taleplerini üstlenir / tamamlar (tip denetimi sunucuda, istemci filtresi değil).
`service.override`: sahip, müdür — başkasının üstlendiği talebi tamamlar, talep iptal eder. Mutfak / bar: erişim yok.
Destek modu: görüntüler, değiştiremez. Üstlenme koşullu güncelleme (`status = OPEN`): eşzamanlı ikinci tıklama
"Bu talep başka bir personel tarafından alındı." alır. Tamamlama: üstlenen ya da yönetici; başka garson tamamlayamaz.
Yeniden atama / atamayı bırakma bu sürümde yok. Denetim: SERVICE_REQUEST_CREATED (müşteri, IP'siz) / ACKNOWLEDGED /
COMPLETED / CANCELLED.


# Sprint 9 — Sesli AI asistan

## 63. Ses mimarisi

Mikrofon (yalnızca dokunuşla) → `MediaRecorder` tek ifade (≤ 45 sn, ≤ 3 MB; elle bitir ya da ~1,5 sn sessizlik) →
`POST /t/<token>/asistan` (multipart) → STT → **deterministik dil kararı** → araçlı AI turu → güvenlik koruması →
yanıt + eylem kartları → `POST /t/<token>/asistan/ses` (yalnızca bu konuşmanın asistan mesajı) → oynatma.
Bas-konuş modeli (sürekli açık mikrofon yok); konuşurken mikrofona dokunmak sesi keser ve dinlemeye geçer.
Durum makinesi `src/lib/voice/session.ts` (READY / LISTENING / THINKING / SPEAKING / ERROR). Kapatınca mikrofon izleri
ve oynatma durur; indirilmekte olan yanıt sesi "konuşma kuşağı" sayacıyla geçersiz kılınır (kapattıktan sonra ses çalmaz).
**Ham ses saklanmaz**: istek belleğinde STT'ye gider ve atılır; diske / veritabanına / loga yazılmaz.
CSP: `media-src 'self' blob:` (yanıt sesi blob URL), `Permissions-Policy: microphone=(self)`.
Panel kodu tembel yüklenir (`next/dynamic`, AI kapalı işletmede indirilmez); menüde yalnızca küçük CTA etiketi.

## 64. Sağlayıcılar (`src/lib/ai/provider.ts`, `src/lib/voice/provider.ts`, `src/server/services/ai/providers/*`)

Arayüzler: `AiProvider.complete` (araç döngüsü, ≤ 4 tur), `SttProvider.transcribe`, `TtsProvider.synthesize`.
Sprint 9 uygulaması **OpenAI** (REST, SDK yok, yalnızca sunucu): chat completions + araç çağrısı (varsayılan
`gpt-4.1-mini`), `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts` (dil başına ses: tr coral, en alloy, de sage, ar shimmer,
ru nova; `VOICE_TTS_VOICE_*` ile değişir; konuşma tonu talimatı). `mock` sağlayıcılar yalnızca geliştirme / test:
kural tabanlı asistan **aynı araç katmanını** kullanır (güvenlik testleri anlamlı), mock STT `MOCK-STT:<metin>` baytını
çözer, mock TTS sessiz WAV üretir. Sağlayıcı yoksa asistan "yapılandırılmamış" (müşteriye gösterilmez).
Anahtarlar `src/lib/env.ts` (server-only); istemci paketinde anahtar / sağlayıcı adresi / sistem istemi YOK (statik test).

## 65. Dil algılama ve geçiş (`src/lib/voice/language-detection.ts`, `src/lib/ai/language.ts`)

Desteklenen konuşma dilleri: tr, en, de, ar, ru — menü (arayüz) dilinden bağımsız. Algılama modelden bağımsız ve
deterministik: (1) açık geçiş = dil adı (5 dilde) + değiştirme ipucu ya da kısa ifade (0,98); (2) Arapça / Kiril alfabe
oranı (0,95); (3) Latin için sık kelime + özel harf puanı. Güven < 0,75 ise mevcut dil korunur; 0,5–0,75 arasında farklı
aday varsa kısa netleştirme sorulur. Geçişte onay cümlesi **bir kez** söylenir; konuşma dili `AiConversation`'da kalıcı.
Saf dil değişimi ("Do you speak English?") model çağrısı yapmaz. İsteğe bağlı "Menüyü de X göster" bağlantısı; menü dili
kendiliğinden değişmez. Rusça yalnızca asistan katmanında (menü / sepet çevirisi kapsam dışı — bilinen sınır).

## 66. Konuşma gizliliği (`conversation.service.ts`)

AI geçmişi masa QR'ıyla PAYLAŞILMAZ. Konuşma 32 baytlık kanıtla (proof) sürer: tarayıcı yerel deposunda, `x-mn-ai-proof`
başlığında gelir; sunucuda yalnızca SHA-256 özeti. Kanıt tek başına yetmez: aynı kiracı + aynı masa + geçerli QR bağlamı +
süre (3 sa hareketsizlik, en fazla 6 sa). Yeni tarayıcı / masa → yeni konuşma; eski içerik görünmez. Modele en fazla son 8
mesaj gider. `AiMessage` yalnızca görünür içerik + yapılandırılmış meta (eylem kartları) tutar; gizli akıl yürütme yok.

## 67. Güvenli araçlar ve eylem onayı (`src/lib/ai/tools.ts`, `tools.service.ts`)

Okuma: searchMenu, getProductDetails, getProductAvailability, getProductPrice, getRecommendationCandidates,
getCartSummary, getOrderStatus. Hazırlık (DEĞİŞTİRMEZ): prepareCartAddition, prepareCartChange, prepareServiceRequest,
openCartReview. **Sipariş gönderme aracı yoktur.** Argümanlar Zod ile doğrulanır; kimlik argümanı yoktur (bağlam sunucuda).
Ürün verisi `toPublicMenuView` çıktısından (gizli / arşiv / şubede kapalı ürün içermez; fiyat merkezi çözümleyiciden).
Eylem kartları yalnızca doğrulanmış araç sonuçlarından üretilir; müşteri düğmeye basınca MEVCUT mantık çalışır
(sepet `addLine`, ürün yapılandırıcısı, Sprint 8 servis talebi — mükerrer koruması dahil, sepet sayfası). Zorunlu ekstra
ya da birden çok varyant → tahmin yok, yapılandırıcı açılır (ör. demo Ayran: Küçük / Büyük söylenmeli).

## 68. Öneri motoru (`src/lib/ai/recommendation.ts`)

Kişi sayısı / bütçe / tür / diyet etiketi / alerjen kaçınma / acı tercihi; bütçe ve kişi sayısı konuşmadan deterministik
çıkarılır (5 dil). Kişi başı ana yemek (öne çıkanlar önce, çeşitlilik), kalırsa içecek, sonra paylaşımlı tatlı; toplam
sunucuda ve **bütçe asla aşılmaz** (güvenlik ağı). Tükenen ürün önerilmez; "en çok satan" yerine "restoranın öne çıkardığı".
Arama dolgu kelimeleri (5 dil) yok sayar; malzeme eş anlamlıları diller arası genişletilir (chicken → tavuk …).

## 69. Alerjen ve diyet güvenliği

Bilgi girilmemişse (`allergenInfoDeclared = false`) "yeterli alerjen bilgisi belirtilmemiş"; yokluk çıkarımı yapılmaz,
kaçınma filtresinde ürün dışarıda kalır. Yanıtlar "restoranın belirttiği bilgilere göre" + çapraz bulaşma uyarısı.
Diyet / helal yalnızca açık etiketle. `guardAssistantText` mutlak güvence ve satış iddialarını düzeltir.

## 70. İstem katmanları ve kapsam (`src/lib/ai/prompts.ts`, `safety.ts`)

Platform güvenliği → asistan kuralları → güvenilir restoran bağlamı → işletme tonu / notu (düşük güven, ≤ 300, güvenlik
çiğneyen cümleler atılır) → dil durumu → konuşma → müşteri ifadesi (en düşük güven). Sistem istemi / anahtar / başka
restoran istekleri kısaca reddedilir; restoran dışı konular yönlendirilir. Araç katmanı kiracı dışına zaten erişemez.

## 71. Özellik kapısı, ayarlar, kullanım, hız sınırı

`requireFeature(scope, "ai_voice")` + `getVoiceAiAccess` (paket AI → `AiSettings.enabled` → sağlayıcı). Her uç nokta
denetler; düğme gizleme güvenlik değildir. `/panel/ai` (ai.manage; destek modu salt okunur; `AI_SETTINGS_UPDATED`
denetimi, metin içeriği loglanmaz). `AiUsage`: konuşma, mesaj, token, STT ms, TTS karakter, gecikme, başarı / hata kodu —
faturalama fiyatı yok; konuşmaya FK ile bağlı DEĞİL (konuşma silinse / süresi dolsa da ölçüm kalır). `/panel/ai` bugün / bu ay; `/admin/ai-kullanimi` kiracı bazında meta veri (içerik gösterilmez).
Hız sınırı (bellek içi, Redis'e taşınabilir): konuşma 20 / dk, masa 60 / 10 dk, IP 300 / 10 dk (ikincil), oturum açma
masa 20 / 10 dk, ses üretimi konuşma 30 / dk; konuşma başına en fazla 60 kullanıcı turu; metin ≤ 500 karakter.
Sağlayıcı hataları müşteriye kısa mesaj; menü / sepet / sipariş etkilenmez.

## 72. Testler

Birim: dil algılama / geçiş / güven, durum makinesi, kapı, menü bağlamı, araç şemaları, öneri / bütçe, alerjen, sepet ve
servis hazırlığı, kanıt / süre, kullanım, hız sınırı, istem katmanları, kapsam, Rusça / Arapça metinler, CSP.
Neon entegrasyon (mock sağlayıcı): ayar, paket kapısı, kanıt, masa / kiracı izolasyonu, dil kalıcılığı, mesaj ve kullanım,
gerçek menü / şube fiyatı, gizli / tükenen ürün, alerjen, mükerrer servis, süre, yeni tarayıcı, ses sınırları, sağlayıcı hatası.
Tarayıcı: mikrofon / MediaRecorder taklidi ile uçtan uca. Gerçek sağlayıcı: `AI_SMOKE=1 npm run test:ai-smoke` (isteğe bağlı).

## 73. Canlı sesli konuşma — mimari (Sprint 10)

Bas-konuş (Sprint 9) korunur ve otomatik YEDEK olur. Canlı mod tarayıcı ↔ sunucu NDJSON akışıyla çalışır:

```
Mikrofon (açık dokunuş) → PCM + VAD (src/lib/voice/pcm-capture.ts, vad.ts) → ifade sonu → 16 kHz WAV
  → POST /t/<token>/asistan/canli  { turnKey, audio(base64) | text, muted, cart, recentOrders }   (kanıt başlıkta)
  ← NDJSON: accepted → transcript → (language) → text* / audio* → actions → done   |  error{code, retryable}
Oynatma: Web Audio kuyruğu (audio-queue.ts) — cümleler sırayla, boşluksuz; nesil sayacıyla iptal.
Rapor:   POST /t/<token>/asistan/canli/rapor { turnKey, playedMs, interrupted }
```

Sunucu (`realtime.service.ts`) bas-konuşla AYNI motoru kullanır (`assistant.service.ts`: `prepareTurn` → `readUtterance`
→ `generateReply` → `appendTurn`): kapı, kanıt, hız sınırı, dil kararı, bağlam, güvenli araçlar, güvenlik koruması.
Fark yalnızca çıktının akmasıdır. Sağlayıcıya özgü olaylar tarayıcıya gitmez; arayüz yalnızca `src/lib/ai/realtime.ts`
olay tiplerini bilir.

**Neden tarayıcıdan doğrudan sesten-sese (WebRTC) değil:** her cümle seslendirilmeden önce sunucu tarafı güvenlik
koruması, deterministik dil kararı ve araçların sunucuda çalışması bu sprintin kesin kuralları. Bu yol ayrıca tarayıcıya
hiçbir sağlayıcı anahtarı (geçici olanı dahil) vermez ve CSP'yi DEĞİŞTİRMEZ (`connect-src 'self'` yeterli). Sesten-sese
bir sağlayıcı, `RealtimeVoiceProvider` arayüzünü uygulayarak ileride eklenebilir (§74).

## 74. Sağlayıcı soyutlaması (`src/server/services/ai/realtime/provider.ts`)

`RealtimeVoiceProvider.connect(signal?)` → `RealtimeVoiceSession { transcribe, respond(request, onTextDelta), speak,
interrupt, disconnect, testHook }`. Uygulama: **cascade** — STT (güven puanıyla; OpenAI'de `include[]=logprobs`) →
akan sohbet (`AiProvider.stream`, SSE; araç çağrısı başlarsa metin akışı durur, araç sonucundan sonra yanıt akar) →
cümle başına TTS. `interrupt()` tüm sağlayıcı isteklerini `AbortSignal` ile iptal eder. `VOICE_REALTIME=off` canlı modu
kapatır (istemci bas-konuşa düşer). Mock sağlayıcı: kelime kelime akış, sessiz WAV, test kancaları (`#drop` = kayıttan
sonra bağlantı kopması, `#down` = sağlayıcı yok) — kancalar YALNIZCA AI ve STT ikisi de mock iken etkindir.

## 75. Durum makinesi ve tur algılama (`src/lib/voice/live-session.ts`, `vad.ts`, `config.ts`)

Tek durum: `IDLE → CONNECTING → LISTENING ⇄ USER_SPEAKING → THINKING → ASSISTANT_SPEAKING → LISTENING`; ayrıca
`INTERRUPTING`, `RECONNECTING`, `FALLBACK`, `ERROR`, `ENDED`, `READY`. Mikrofon yalnızca `MIC_ACTIVE` durumlarında açık.
VAD (merkezi `VAD_CONFIG`): uyarlanır gürültü tabanı (sessiz karelerde EMA), konuşma = taban × 3 (en az 0,012 RMS),
başlangıç 220 ms kesintisiz konuşma (tıkırtı / tabak sesi sayılmaz), ifade sonu 900 ms sessizlik (restoran ortamında
erken kesmemek için), ifade üst sınırı 30 sn, 300 ms ön tampon (ilk hece kaybolmaz). Tarayıcıdan yankı giderme +
gürültü bastırma + otomatik kazanç istenir. Düşük güvenli konuşma metni (< 0,55) → tahmin / araç yok:
"Sizi tam anlayamadım. Tekrar eder misiniz?".

## 76. Araya girme (barge-in)

Otomatik: asistan konuşurken VAD "barge-in" modunda (taban × 5, 320 ms — hoparlör sızıntısı / yankı yanlış kesmesin).
Elle: "Sözü Kes". Her ikisinde: nesil sayacı artar → devam eden istek iptal → ses kaynakları ANINDA durur → eski neslin
geç gelen parçaları atılır → kesilen turun kartları geçersiz → sunucuya rapor (çalınan süre + kesinti). Sunucuda yanıt
metni yine de tamamlanıp kaydedilir (yeniden bağlanmada tutarlı tekrar için); kesilen yanıtın kartları tekrarda
gösterilmez. Rapor kayıttan ÖNCE gelirse yanıt "kesildi" olarak kaydedilir (`appendTurn` içinde).

## 77. Akış: metin ve ses

`SentenceBuffer` (`src/lib/ai/stream-text.ts`) deltaları cümlelere böler (kısa parça / kısaltma birleşir, "₺380," gibi
yarım sayı beklenir). Her cümle `guardAssistantText` korumasından geçtikten SONRA metin olarak hemen, ses olarak sırayla
gönderilir — akış güvenliği atlamaz. Yapılandırılmış eylem kartları (`actions`) yalnızca tur kaydedildikten sonra tek
seferde gelir; model hiçbir değişikliği kendisi yapmaz, sesli "evet" bir mutasyon onayı DEĞİLDİR (yalnızca düğme).

## 78. Dil geçişi ve konuşma bağlamı

Dil kararı Sprint 9 ile aynı (deterministik, güven eşikli): karışık dil ("Bir chicken burger önerir misin?") Türkçe
kalır; açık geçiş BİR kez onaylanır (`language` olayı + onay cümlesi); ses dil başına seçilir. Bağlam
(`AiConversation.context`, `src/lib/ai/conversation-context.ts`): kişi sayısı, bütçe, diyet (alt küme: "birimiz vegan"),
acı tercihi, son niyet — her ifadeden deterministik güncellenir ve hemen kaydedilir (kesintide korunur). Öneriden sonra
gelen kısa kısıt ("Acı da olmasın") öneriyi bağlamdaki TÜM kısıtlarla yeniler. Diyet misafiri yalnızca açık etiketli ana
yemek alır; yoksa açıkça söylenir (uydurma yok).

## 79. Tur idempotency'si, yeniden bağlanma, yedek

İstemci her mantıksal tur için opak 16 baytlık anahtar üretir. `AiTurn (conversation_id, turn_key)` BENZERSİZ:
tamamlanmış tur tekrar işlenmez (metin + kartlar kayıttan, ses yeniden üretilmez → yinelenen `AiMessage` / `AiUsage`
yok); eşzamanlı aynı tur → `in_progress`; kaydedilmemiş (hata / bayat > 30 sn) tur koşullu güncellemeyle yeniden
sahiplenilir. Mesajlar + tur tamamlanması tek işlemde. Akış "done" gelmeden koparsa istemci aynı anahtarla en çok 2 kez
yeniden bağlanır. `provider_unavailable` ya da art arda 2 hata → bas-konuş moduna geçilir ve bekleyen ifade AYNI
anahtarla `/asistan` uç noktasına (JSON + base64 WAV) gider — kayıp ya da çift kayıt olmaz (`AiTurn.mode = FALLBACK`).

## 80. Oturum yaşam döngüsü ve kaynaklar

Tek `AudioContext` (yakalama + oynatma) yalnızca "Sesli Konuşmayı Başlat" dokunuşunda oluşturulur; bitiş / panel
kapanması / sekme gizlenmesi / 45 sn hareketsizlik / 10 dk üst sınır / cihaz kaybında mikrofon izleri durdurulur ve
bağlam KAPATILIR. Mikrofon reddi / cihaz yok: "Mikrofona erişilemedi. Yazarak devam edebilirsiniz." Arayüz: seviye
küresi (CSS değişkeni, React yeniden çizimi yok), "Dinliyorum / Anlıyorum / Yanıtlıyor / Konuşuyor", "Sözü Kes",
"Konuşmayı Bitir"; azaltılmış hareket tercihinde animasyon yok; 5 dil, Arapça RTL.

## 81. Ölçüm ve istatistik

`AiTurn`: mod (REALTIME / FALLBACK), durum, deneme sayısı (yeniden bağlanma), giriş / çıkış ses ms, kesinti zamanı,
hata kodu, `sttMs`, `firstTextMs`, `firstAudioMs`, `totalMs`. `summarizeVoice` (`src/lib/ai/usage.ts`): sesli oturum,
dakika, kesinti, yeniden bağlanma, yedek oranı, sağlayıcı hata oranı, ortalama ilk ses / tur süresi. `/panel/ai`:
bugün / bu ay sesli oturum, süre, söz kesme, yedek turu. `/admin/ai-kullanimi`: kiracı bazında sesli oturum, ses
dakikası, yedek oranı, sağlayıcı hata oranı — içerik yok.

## 82. Güvenlik

Uç noktalar: QR bağlamı (kiracı + masa), paket / ayar kapısı, konuşma kanıtı (başlıkta), süre, hız sınırı (yeniden
denemeler dahil her istek), gövde boyutu (JSON base64 ses ≤ ~4 MB; çözülmüş ses ≤ 3 MB, ≤ 45 sn). Tarayıcıda uzun
ömürlü ya da geçici sağlayıcı anahtarı YOK; araçlar yalnızca sunucuda. Rapor uç noktası yalnızca kanıtla doğrulanan
konuşmanın turuna dokunur. Ham ses saklanmaz. CSP değişmedi.

## 83. Testler (Sprint 10)

Birim (`tests/unit/realtime-voice.test.ts`): durum makinesi, VAD (tıkırtı, gürültü tabanı, barge-in eşiği, üst sınır,
ön tampon), WAV, ses kuyruğu + nesil (geç parça çalmaz), cümle tamponu, NDJSON, yeniden bağlanma kararı, karışık dil
kararlılığı, bağlam + diyet misafiri, sağlayıcı sözleşmesi (akış, iptal, güven, test kancası), ölçüm özeti.
Neon entegrasyon (`tests/integration/realtime-voice.test.ts`, 12): olay sırası + kartlar kayıttan sonra, tekrar,
eşzamanlı tur, kopma → yeniden bağlanma, sağlayıcı yok → yedek aynı anahtar, kesinti raporu, kayıttan önce kesinti,
düşük güven, dil, öneri + kısıt, izolasyon, sessiz mod + ölçüm. Tarayıcı: osilatörlü sahte mikrofon (VAD gerçekten
çalışır) + istek yakalama ile uçtan uca; AudioContext sayacıyla sızıntı denetimi. Gerçek sağlayıcı:
`AI_SMOKE=1 npm run test:ai-smoke` (canlı akış dahil, isteğe bağlı).

## 84. Üretim sertleştirme — genel bakış (Sprint 11)

Hedef topoloji: Nginx → PM2 (tek süreç ya da küme) → Next; Neon (pooled) + Redis (isteğe bağlı, kümede zorunlu).
Bellek içi durum taşıyan üç şey Redis arkasına alınabilir hale getirildi: gerçek zamanlı olay yolu, hız sınırı, (gerekirse)
önbellek. Veritabanı bütünlüğün TEK kaynağıdır (sipariş anahtarı, servis talebi aktif yuvası, AI turu benzersizliği);
Redis yetki ya da bütünlük kaynağı değildir. Kontrol listesi: `docs/production-checklist.md`.

## 85. Redis soyutlaması (`src/lib/redis/`)

`keys.ts` (saf): `mn:<namespace>:rl:<politika>:<sha256(özne)>` ve `mn:<namespace>:rt:<kanal>`. Kanal yalnızca sunucu
biçimlerinden biri (`tenant:<id>:orders`, `order:<id>`, `table:<id>`) — beyaz liste dışı ad (joker, ek parça, satır sonu)
reddedilir; gelen mesajın ad alanı / biçimi yeniden doğrulanır. `client.ts`: komut + abone bağlantıları (globalThis'te
tekil), çevrimdışı kuyruk kapalı (Redis yoksa komut hemen hata verir → açık yedek davranışı), yeniden bağlanma
(200 ms → 2 sn), otomatik yeniden abonelik, `redisHealth()`, `closeRedis()`. REDIS_URL çekirdek ortam
doğrulamasından bağımsız okunur (hatalı değer Redis'i kapatır, platformu durdurmaz).

## 86. Dağıtık gerçek zamanlı olaylar (`src/server/realtime/`)

`providers.ts`: `InMemoryProvider` (tek süreç) ve `RedisProvider` (Pub/Sub). Redis sağlayıcısı süreç başına kanal başına
TEK abonelik açar (ilk yerel dinleyicide SUBSCRIBE, sonuncusu gidince UNSUBSCRIBE) ve gelen mesajı sürüm / tip beyaz
listesinden geçirip yerel SSE dinleyicilerine dağıtır. Yayın başarısızsa olay en azından aynı süreçteki abonelere
teslim edilir (`realtime.publish_failed`). SSE (`sse.ts`): açık akış kayıt defteri (kapanışta hepsi kapanır, yeni akış
503), heartbeat 25 sn + her heartbeat'te yetki yeniden doğrulama, saatte bir yenileme, `X-Accel-Buffering: no`,
`sse.connections` göstergesi. İstemci sözleşmesi değişmedi.

## 87. Dağıtık hız sınırı (`src/server/rate-limit/`)

Tek mimari: `rateLimit(politika, özne)`, `rateLimitAll([...])`, `resetRateLimit()`. Tüm sınırlar `policies.ts`'te
(QR girişi, sipariş, servis, AI, giriş, demo talebi — sayılar öncekiyle aynı). Redis arka ucu sabit pencereyi TEK atomik
işlemde uygular: `MULTI INCR / PEXPIRE NX / PTTL EXEC` (GET-sonra-SET yarışı yok; Redis ≥ 7). Redis erişilemezse
politika başına açık yedek: AI → ret, diğerleri → süreç içi bellek (sınır kalkmaz). Testler için
`resetRateLimitStateForTests()` (HTTP üzerinden açılmaz).

## 88. AudioWorklet yakalama (`src/lib/voice/pcm-capture.ts`, `public/worklets/capture-processor.js`)

Mikrofon PCM'i artık ses iş parçacığında AudioWorklet ile alınır (128 → 1024 örnek blok, aktarılabilir tampon);
VAD / ifade biriktirme ana iş parçacığında ortak kare işleyicide. Modül SABİT ve aynı origin'den
(`/worklets/capture-processor.js`, CSP `script-src 'self'` — CSP değişmedi; uzak modül yüklenemez, tarayıcı testi ile
doğrulandı). AudioWorklet yoksa ya da modül yüklenemezse eski ScriptProcessor yedeği. Durdurmada işlemciye "stop"
mesajı (process → false), port kapanır, düğümler ayrılır, izler durur; bağlam oturum sonunda kapanır.

## 89. Nazik kapanış ve yeniden başlatma (`src/server/lifecycle/shutdown.ts`, `instrumentation.ts`)

SIGTERM / SIGINT → öncelik sırasıyla kancalar (her biri zaman aşımlı, toplam ≤ 8 sn): yeni uzun bağlantı reddi → SSE
kapanışı → canlı ses turlarının iptali + `FAILED/shutdown` işareti → gerçek zamanlı sağlayıcı → Redis → Prisma.
`NEXT_MANUAL_SIG_HANDLE=true` önerilir. Sert ölümde (çökme / kill -9) tur kalp atışı (5 sn) durur; tur 15 sn sonra başka
süreç tarafından koşullu güncellemeyle yeniden sahiplenilir. İstemci: kopma / 502-504 / `shutting_down` → aynı tur
anahtarıyla üstel bekleme (600 ms → 5 sn, 6 deneme ≈ 20 sn), `in_progress` için 25 sn bütçe. Sipariş istemcisi ağ
hatasında anahtarı korur → yeniden denemede aynı sipariş döner.

## 90. Sağlayıcı zaman aşımları ve maliyet koruması (`src/lib/ai/limits.ts`)

Tek yerde: STT / sohbet / TTS 20 sn, canlı tur 60 sn; ifade ≤ 45 sn / 3 MB, ≤ 60 tur, ≤ 350 token, ≤ 900 TTS karakteri,
canlı oturum 45 sn hareketsizlik / 10 dk. Sağlayıcı isteğinde zaman aşımı + çağıranın iptali `AbortSignal.any` ile
İSTEĞİN TAMAMINI kapsar (önceden yalnızca başlıklar gelene kadar geçerliydi — takılan akış gövdesi yetim kalabiliyordu;
düzeltildi ve testlendi). Canlı tur üst süresi tüm sağlayıcı çağrılarını birlikte iptal eder.

## 91. Gözlemlenebilirlik (`src/lib/observability/`)

`logger.ts`: satır başına JSON, `redact()` ile hassas alan adları ve metin kalıpları (anahtar, bağlantı dizesi, Bearer,
QR yolu) kırpılır; `setErrorReporter()` satıcıdan bağımsız kanca (Sentry / OTel sonra). `correlation.ts`: proxy
`x-request-id` ekler (gelen geçerliyse korunur), yanıtta döner; `getRequestId()` sunucu kodunda (RequestMeta'dan ayrı —
RequestMeta oturum / denetim satırlarına aynen yazılır). `errors.ts`: kararlı kodlar. `metrics.ts`: süreç içi
sayaç / gösterge / gecikme; `/api/admin/metrics` (Super Admin). `instrumentation.ts`: açılış tanılaması +
`onRequestError` yapılandırılmış log.

## 92. Sağlık (`/api/health`, `system.service.ts`)

`database` (zorunlu), `redis` (connected / disconnected / not_configured), `realtime` (memory / redis), `aiConfigured`,
`configWarnings` (yalnızca değişken adları). 503 yalnızca veritabanı yoksa; Redis yoksa 200 `degraded`.

## 93. SSRF (`src/lib/security/ip.ts`, `src/server/security/safe-fetch.ts`)

Yalnızca küresel tek-yayın adresler: IPv4 özel / geri döngü / CGNAT / bağlantı-yerel (meta veri) / belgeleme /
kıyaslama / çok noktaya yayın ve IPv6 geri döngü / ULA / bağlantı-yerel / site-yerel / çok noktaya yayın / IPv4-eşlemeli /
NAT64 / 6to4 (gömülü IPv4 denetlenir) reddedilir. `safeFetch`: https:443, kimlik bilgisiz, IP literal ve yerel ad yok;
ad bağlantı anında özel `lookup` ile çözülür, TÜM adresler denetlenir ve soket doğrulanan adrese bağlanır (DNS rebinding
penceresi kapalı); yönlendirme izlenmez; boyut / süre sınırı. Logo indirme bu yolu kullanır.

## 94. Ortam doğrulama (`src/lib/env.ts`, `src/lib/env-diagnostics.ts`)

Çekirdek değişkenler katı (eksikse açılmaz); AI / ses / Redis / log alan alan hoşgörülü (hatalı alan yok sayılır,
`getEnvIssues()` ile adı raporlanır). Sınıflar: core / ai / redis / production / optional. `npm run env:check`.

## 95. Test yalıtımı ve orkestrasyon

Tarayıcı paketleri depoda (`tests/e2e/`). `npm run test:regression`: bir kez derle → her paket için TAZE `next start`
süreci (paketin profiliyle: ör. mock AI), sağlık bekle, paketi çalıştır, süreci durdur — bellek içi sayaç / önbellek /
sağlayıcı ayarı paketler arası taşınmaz (Sprint 9/10'daki etkileşimin çözümü). Sprint 11 paketi kendi topolojisini kurar:
test ters vekili (`tests/e2e/lib/proxy.cjs`, Nginx benzetimi) arkasında iki süreç + sahte Redis
(`tests/support/fake-redis.ts`, RESP alt kümesi; yalnızca test aracı). Gerçek Redis bu ortamda bulunmadığından Redis
davranışı gerçek istemci (ioredis) ↔ sahte sunucu protokolüyle doğrulandı; gerçek Redis 7'ye karşı koşu yayın öncesi
önerilir.

## 96. Analitik — genel bakış (Sprint 12)

`/panel/analitik` (sekmeler: Genel, Ürünler, Masalar, Operasyon, Servis, AI). Sunucu bileşenidir; yetki `analytics.view`
(sahip, yönetici; garson / kasiyer / mutfak / bar → 404). Yetki denetimi `analitik/layout.tsx` içinde, yani `loading.tsx`
sınırının dışında yapılır; böylece yetkisiz istek akış başlamadan gerçek 404 durum kodu alır. Sayfa ve CSV rotası ayrıca
denetler. Kiracı her zaman oturumdan alınır; şube parametresi kiracıya ait değilse "Şube bulunamadı" gösterilir. Grafik
kütüphanesi kullanılmaz: grafikler sunucuda SVG / HTML olarak çizilir (`components/analytics/charts.tsx`, `role="img"`,
`<title>` ipucu, "Tabloyu göster" yedeği).

Katmanlar:

- `lib/analytics/` — saf modüller: zaman, aralık, metrik, CSV, etiketler (birim testli).
- `server/analytics/` — SQL toplama, önbellek, servis, CSV akışı.
- `app/panel/analitik/` — sayfa ve CSV rotası.
- `components/analytics/` — görünüm bileşenleri.

## 97. Tanımlar — "Sipariş Tutarı" (gelir / kâr / marj DEĞİL)

- **Satış sayılan sipariş:** `acceptedAt` dolu VE durum `ACCEPTED | PREPARING | READY | SERVED` olan siparişler.
  Reddedilen, iptal edilen ve kabul bekleyen siparişler tutara girmez; huni ve sayımlarda ayrıca görünürler.
- **Sipariş tutarı:** `orders.total_minor` (kuruş, tamsayı). Sistemde KDV, indirim ve ödeme bilgisi olmadığından
  "gelir" denmez. Tek para birimi kullanılır: işletmenin `defaultCurrency` değeri. Başka para birimindeki siparişler
  hariç tutulur.
- **Dönem ataması:** `created_at` (= `submittedAt`), yerel saate göre. Ortalama = tutar / satış sayılan sipariş sayısı.
- **Huni:** ulaşılan aşamaların zaman damgalarına göre (gönderilen → kabul → hazırlanan → hazır → servis); ret ve
  iptal ayrı gösterilir.
- **Ürün katkısı:** `order_items.line_total_minor` (sipariş anındaki fiyat görüntüsü). Ürün adı GÜNCEL addır (gerekirse
  "eski adı" ile). Silinmiş ürün anlık görüntü adıyla, arşivlenmiş ürün etiketle gösterilir. Kategori, ürünün GÜNCEL
  kategorisidir (tarihsel değil).
- **Menü dörtlü tablosu:** satış adedi × katkı, medyana göre (en az 4 ürün). Maliyet verisi olmadığından kârlılık DEĞİLDİR.

## 98. Tarih aralığı ve saat dilimi

`lib/analytics/range.ts` şu aralıkları destekler: Bugün, Dün, Son 7 / 30 gün, Bu ay, Geçen ay, Özel (en fazla 366 gün;
gelecek tarih reddedilir).

- **Saat dilimi:** şube ayarı, yoksa işletme ayarı (`Europe/Istanbul` vb.).
- **Sınırlar:** yerel gece yarısından UTC'ye çevrilir; SQL'de `((col AT TIME ZONE 'UTC') AT TIME ZONE $tz)`.
- **Kovalar:** aralık ≤ 2 gün ise saatlik, aksi hâlde günlük. Kovalar DST'ye duyarlıdır (`bucketKeys`); geri alınan
  DST saatinde iki yerel saat tek kovada birleşir (Türkiye'de DST yok).

## 99. Karşılaştırma

Önceki dönem, aynı uzunluktaki hemen önceki aralıktır. Süren dönemde (Bugün, Bu ay) önceki dönem de AYNI geçen süreyle
kesilir: bugün 14:00'e kadar ↔ dün 14:00'e kadar. Önceki değer tabanın altındaysa (sayımlar için 5) yüzde gösterilmez,
yerine "Karşılaştırma için yeterli veri yok" yazılır. p90 yalnızca n ≥ 10 olduğunda, ısı haritası en az 20 siparişte
gösterilir.

## 100. Sorgu tasarımı ve performans

- **Parametreli sorgular:** tümü `prisma.$queryRaw` + `Prisma.sql`; `Prisma.raw` yalnızca sabit sütun adları için.
  Her sorgu `tenant_id` filtresiyle başlar.
- **Kalem toplamları:** önce `WITH o AS MATERIALIZED (sipariş filtresi)`, sonra `order_items` birleşimi. İstatistikler
  bayatken planlayıcı iç içe döngü seçiyordu ve 10k siparişte sorgu ~2 dk sürüyordu; MATERIALIZED ile p95 ≤ 275 ms.
- **Yeni indeksler** (`20261018000000_sprint12_analytics_indexes`):
  - `order_tickets(tenant_id, created_at)`
  - `table_service_requests(tenant_id, created_at)`
  - `ai_messages(tenant_id, role, created_at)`
- **Yük testi:** `tests/load/analytics.load.test.ts` (10k sipariş, 30k kalem, 8,7k fiş, 3k talep). EXPLAIN çıktısını
  `tmp/analytics-explain.txt` dosyasına yazar.

## 101. Önbellek

`server/analytics/cache.ts`, 45 sn TTL ile çalışır.

- **Anahtar:** kiracı, şube, başlangıç, bitiş, saat dilimi, para birimi ve bölümün özetlenmiş birleşimi.
- **Depo:** Redis yapılandırılmışsa Redis, değilse süreç belleği.
- **"Şimdi":** 30 sn'ye yuvarlanır (`analyticsNow()`), böylece aynı yarım dakikadaki istekler aynı anahtarı paylaşır.
  Sayfada "Son güncelleme" bilgisi ve "Yenile" düğmesi vardır.
- **Metrikler:** `analytics.cache_hit`, `cache_miss`, `errors`, `slow_queries` (1500 ms üzeri; istek kimliğiyle uyarı
  logu) ve `exports`.

## 102. Masa, KDS, servis, AI

- **Masa / bölge:** güncel masa adı (gerekirse eski adıyla); bölge, sipariş anındaki görüntüdür ("Bölgesiz" olabilir).
  QR taramaları yalnızca TOPLAM olarak gösterilir (masa başına `scanCount`). Tarih aralıklı tarama geçmişi tutulmadığı
  için dönem filtresi uygulanmaz.
- **KDS:** kabul (gönderim → kabul), hazırlama (kabul → hazır) ve servis (hazır → servis) süreleri için ortalama, medyan
  ve p90; ayrıca istasyon bazında fiş süreleri (başlangıç → hazır). Personel bazlı sıralama YOKTUR.
- **Servis:** tür, saat, bölge ve masaya göre dağılım; yanıt (oluşturma → onay) ve tamamlanma süreleri. Personel adı
  gösterilmez.
- **AI:** konuşma, tur (canlı / yedek), söz kesme, yeniden bağlanma, başarısız tur, ses süresi, konuşma ve mesaj dili,
  eylem türleri, ürün kartı ve öneri sayısı. Mesaj İÇERİĞİ hiçbir sorguda seçilmez. Güvenilir bağlantı verisi olmadığı
  için AI → sipariş ilişkilendirmesi yapılmaz; bu durum sayfada açıkça belirtilir.

## 103. CSV dışa aktarma

`GET /panel/analitik/disa-aktar?tur=orders|products|service|kds&aralik=…`

- **Yetki:** `analytics.export` (sahip, yönetici) ve yazma bağlamı; Super Admin destek modunda ENGELLİ.
- **Akış:** sunucuda üretilir; UTF-8 BOM, `; charset=utf-8`, keyset sayfalama. Sınırlar: en fazla 50.000 satır ve 366 gün.
- **Formül enjeksiyonu:** `= + - @ \t \r` ile başlayan hücrelere `'` öneki eklenir.
- **Zaman damgaları:** yerel saat + ofset (`2026-06-15 14:05 +03:00`).
- **Gizlilik:** müşteri notu, personel adı ve AI içeriği dışa aktarılmaz.

## 104. Testler (Sprint 12)

- **Birim:**
  - `tests/unit/analytics.test.ts` — aralık, saat dilimi, DST, karşılaştırma, yüzdelik, CSV kaçışı, para.
  - `tests/unit/analytics-authorization.test.ts` — rol, destek modu, çapraz kiracı şubesi, geçersiz tür.
- **Entegrasyon (Neon):** `tests/integration/analytics.test.ts` — iki kiracı, sabit "şimdi".
- **Yük:** `tests/load/analytics.load.test.ts`.
- **Tarayıcı:** `tests/e2e/e2e-sprint12.cjs` — demo kiracıya geçici deterministik veri yazar, panelden doğrular ve siler.

## 105. Prisma güvenlik kilidi (Sprint 12 olay düzeltmesi)

2026-10-11'de `prisma migrate diff --from-migrations … --shadow-database-url <DIRECT_URL>` komutu geliştirme veritabanını
sıfırladı (Prisma shadow DB'yi tek kullanımlık sayar). Korunması gereken gerçek veri olmadığından veri yeniden seed
edildi. Kalıcı önlem `prisma/guard.ts`'tir; `prisma.config.ts` üzerinden HER prisma CLI komutunda çalışır:

- **Shadow ana veritabanı olamaz:** shadow (bayrak ya da `SHADOW_DATABASE_URL`), `DATABASE_URL` / `DIRECT_URL` ile aynı
  veritabanıysa komut çıkış kodu 1 ile durur. Karşılaştırma metne değil kimliğe dayanır:
  - Neon: uç nokta (`-pooler` eki atılır, `options=endpoint=` desteklenir) + veritabanı.
  - Diğerleri: host (localhost / 127.0.0.1 / ::1 eşdeğer) + port + veritabanı.
- **Shadow zorunlu:** shadow gerektiren `migrate diff --from/--to-migrations`, ayrı shadow olmadan engellenir.
- **Veri silen komutlar:** `migrate reset`, `migrate dev` ve `db push --force-reset / --accept-data-loss` varsayılan olarak
  ENGELLİDİR. Yalnızca yerel veritabanında `MASANOVA_ALLOW_DB_RESET=I_UNDERSTAND_THIS_DROPS_DATA` ile çalışırlar; uzak
  veritabanında asla.
- **Güvenli SQL üretimi:** `npm run db:diff` (`--from-url DIRECT_URL --to-schema-datamodel`, shadow yok).

Sınır: aynı Neon dalına bağlı iki FARKLI uç nokta (ör. okuma kopyası) bağlantı dizesinden ayırt edilemez. Testler:
`tests/unit/prisma-guard.test.ts`.

## 106. Görsel yükleme — genel bakış (Sprint 13)

İşletme, ürün görseli, kategori banner'ı, QR menü kapağı ve logoyu bilgisayardan yükler. Akış:

```
panel (ImageUploader, XHR)  →  POST /api/v1/media (multipart)  →  media.service.uploadMedia
   → processImage (sharp: imza + çözme + boyut / piksel / animasyon denetimi, EXIF yönü, meta veri atma, çıktılar)
   → ImageStorageProvider.put (yeni rastgele anahtar)  →  DB transaction (MediaAsset + referans + denetim)
   → commit sonrası eski dosyalar silinir  →  invalidatePublicMenu (expire 0)  →  menü hemen günceller
```

Katmanlar:

- `lib/media/` — saf kurallar (tür, sınırlar, önerilen boyutlar, hata metinleri) ve imza tespiti; panel de kullanır.
- `server/media/storage/` — `ImageStorageProvider` arayüzü + `LocalImageStorageProvider`.
- `server/media/` — anahtarlar (`keys.ts`), işleme (`process.ts`), adres çözümü (`urls.ts`), servis, istek ayrıştırma,
  yetim temizliği.
- `app/api/v1/media` (yükle / kaldır) ve `app/media/[...key]` (sunum).

## 107. Depolama soyutlaması ve dosya düzeni

`ImageStorageProvider`: `put` (üzerine yazmaz), `get`, `delete` (idempotent), `exists`, `getMetadata`, `getPublicUrl`,
`listAssetPrefixes` / `deletePrefix` (yetim temizliği). Bugün yalnızca yerel disk; `S3ImageStorageProvider` (Hetzner
Object Storage / S3 / R2) aynı arayüzü uygulayacak. Uygulama mantığı diske bağlı DEĞİLDİR.

```
<UPLOAD_ROOT>/tenants/<kiracı-anahtarı>/{logo,hero,categories,products}/<varlık-id>/<çıktı>.webp|png
```

- **Kök:** `UPLOAD_ROOT` (üretim `/var/lib/masanova/uploads`; geliştirme `./storage/uploads`, git dışı). Uygulama
  klasörlerinin içi (`src/`, `public/`, `.next/`, `prisma/`, `node_modules/`) reddedilir — dağıtım yüklemeleri silmez.
- **Kiracı anahtarı:** `HMAC-SHA256(QR_TOKEN_SECRET, "masanova:media-tenant:v1:" + tenantId)` ilk 22 karakter —
  veritabanı kimliğini açığa çıkarmaz. Kiracı her zaman OTURUMDAN; istemciden gelen kiracı / yol / dosya adı kullanılmaz.
- **Varlık kimliği:** 128 bit rastgele; orijinal dosya adı, e-posta, yerel yol hiçbir yerde yok.
- **Yol geçişi:** anahtar katı desenle doğrulanır, çözülen yol kökün içinde kalmalı (iki katman).
- **Yazma:** geçici dosya + `link` (atomik, var olan anahtarın üzerine yazmaz).

## 108. Veri modeli

`MediaAsset` (`media_assets`): `tenantId`, `kind` (LOGO / HERO / CATEGORY / PRODUCT), `storageProvider`, `storageKey`
(varlık öneki — mutlak yol DEĞİL), `mimeType`, `width`, `height`, `sizeBytes` (tüm çıktılar; kota temeli), `renditions`
(JSON: ad, boyut, bayt, biçim), `createdByUserId`, `createdAt`.

Referanslar (nullable, bileşik FK `(x, tenant_id) → media_assets(id, tenant_id)`, `ON DELETE NO ACTION`):

- `product_images.media_asset_id` + CHECK `(storage_provider = 'media') = (media_asset_id IS NOT NULL)`.
- `menu_categories.image_asset_id`, `public_menu_settings.hero_asset_id`, `tenant_settings.logo_asset_id`.

Bileşik FK başka kiracının varlığına bağlanmayı veritabanında engeller; referanslı varlık silinemez. Kiracı silinince
varlık satırları CASCADE ile gider (dosyalar `media:cleanup` ile). Harici URL alanları (`imageUrl`, `heroImageUrl`,
`logoUrl`, `product_images.storage_key` "external") KORUNUR: eski kayıtlar zorla dönüştürülmez. Öncelik: yüklenen
varlık → harici https adresi. Yükleme, o hedefin harici adresinin yerine geçer (kullanıcının açık isteği). Migration:
`20261101000000_sprint13_media_assets` (`db execute` ile uygulandı; `db:diff` boş).

## 109. Görsel işleme (sharp 0.35)

- **Kabul:** JPEG, PNG, WebP. İmza (sihirli baytlar) VE çözülen biçim eşleşmeli; uzantı / Content-Type'a güvenilmez.
  GIF, SVG, HEIC reddedilir. **SVG:** güvenli temizleme garanti edilemediği için bu sürümde KABUL EDİLMEZ (logo PNG / WebP).
- **Sınırlar:** ürün / kategori 10 MB, kapak 15 MB, logo 5 MB (kaynak); ≤ 12.000 px kenar, ≤ 40 MP. Bomba başlıktan
  reddedilir (`limitInputPixels`), kod çözülmez. Hareketli WebP / APNG REDDEDİLİR.
- **Gizlilik:** EXIF yönü uygulanır, tüm meta veri (EXIF / GPS / XMP / ICC) atılır, sRGB; kaynak SAKLANMAZ — yalnızca
  yeniden kodlanmış çıktılar.
- **Çıktılar (büyütme yok):**

| Tür | Çıktılar | Gösterim |
| --- | --- | --- |
| PRODUCT | lg 1600, md 900, sm 400 (oran korunur) | md + srcset |
| CATEGORY | orig ≤ 3000 (kırpılmamış), lg 1500×500, sm 750×250 (ortadan kırpma) | lg |
| HERO | orig ≤ 3840, lg 1920×640, md 960×320 | lg |
| LOGO | orig ≤ 1024, md 512 (contain, şeffaf), png 512 (etiket PDF'i) | md |

## 110. Sunum ve önbellek

- **Adres:** `/media/<anahtar>` (ya da `UPLOAD_PUBLIC_BASE_URL`). Proxy matcher uzantılı yolları atladığından kiracı
  alan adlarında da çalışır. `Cache-Control: public, max-age=31536000, immutable` — her yükleme / değiştirme YENİ anahtar
  aldığı için tarayıcı önbelleği bayatlamaz (sorgu dizesi hilesi yok). `nosniff` + `sandbox` CSP. Üretimde Nginx
  doğrudan sunabilir (`deploy/nginx.conf.example`).
- **Geçersiz kılma:** yükleme / kaldırma sonrası `invalidatePublicMenu(tenant, "other")` → `revalidateTag(tag, { expire: 0 })`.
  Menü, kapak ve logo bir sonraki istekte günceldir (5 dk beklenmez).
- **Gösterim:** sabit oranlı kaplar (düzen kayması yok), `srcset` + `sizes`; kırık görsel gösterilmez.
- **Panel:** kenar çubuğunda işletme logosu; QR etiket PDF'i yüklenen logonun PNG çıktısını diskten okur (ağ isteği
  yok). Harici adresler Sprint 11 `safeFetch` korumasıyla indirilmeye devam eder.

## 111. API, yetki ve güvenlik

`POST /api/v1/media` (multipart: kind, file, productId / categoryId / replaceImageId) ve `DELETE /api/v1/media` (JSON).

- **Oturum ve destek modu:** `requireTenantUser({ write: true })` — Super Admin destek modu REDDEDİLİR.
- **Yetki:** logo / kapak `branding.manage` (yalnızca sahip); ürün / kategori `menu.manage` (sahip + şube müdürü).
  Garson / kasiyer / mutfak / bar → 404.
- **CSRF:** Origin platform origin'i olmalı.
- **Gövde:** proxy bu yolu tamponlamaz (matcher hariç); rota akış hâlinde ve en fazla 15 MB + ek pay okur, tür sınırını
  ayrıca uygular. Hız sınırı `media.upload` 40 / 10 dk / kullanıcı.
- **Hedef kontrolü:** her sorgu `tenantId` ile süzülür; başka kiracının ürünü / kategorisi / görseli "bulunamadı".
- **Değiştirme sırası:** yeni dosyalar → DB transaction → commit SONRASI eski dosyalar. DB başarısızsa yeni dosyalar
  silinir, eski görsel aynen kalır.
- **Yanıtlar:** dostça hata metinleri; dosya sistemi yolu / istisna metni dönmez.
- **Denetim:** `MEDIA_UPLOADED` / `MEDIA_REPLACED` / `MEDIA_DELETED` — yalnızca tür, biçim, bayt, boyut (bayt verisi /
  yol / depolama anahtarı yok).
- **Kota temeli:** `getTenantMediaUsage` (bayt + adet).
- **Paket ayrımı:** yükleyici yalnızca tema / kategori / ürün sayfalarının paketinde; analitik rotasında yok.

## 112. Yetim temizliği

`npm run media:cleanup -- [--min-age-minutes 60] [--dry-run]`:

- Referanssız `MediaAsset` satırlarını (+ dosyalar) siler; koşul silme anında yeniden denetlenir.
- Diskte karşılığı olmayan varlık klasörlerini siler.
- Eşikten yeni olanlara (sürmekte olan yükleme) ve referanslı varlıklara dokunmaz.

## 113. Testler (Sprint 13)

- **Birim:** `tests/unit/media.test.ts` (imza, anahtarlar, yol geçişi, yerel sağlayıcı, kök denetimi, işleme: GPS / EXIF,
  yön, şeffaflık, bomba, animasyon, sahte dosya; istek ayrıştırma) ve `media-authorization.test.ts` (destek modu,
  roller, şube müdürü ↔ logo / kapak, kiracı oturumdan, CSRF, gövde sınırı).
- **Entegrasyon (Neon + geçici klasör):** `tests/integration/media.test.ts`.
- **Tarayıcı:** `tests/e2e/e2e-sprint13.cjs` (geçici `UPLOAD_ROOT=tmp/e2e/uploads`).
- **Örnek görseller:** `tests/support/images.ts` her koşuda üretir; depoda ikili dosya yok, seed görsel gerektirmez.

## 114. Pazarlama ana sayfası (Sprint 14)

`/` yalnızca platform kök alan adında görünür. Kiracı alan adlarında proxy `/` yolunu `/site`'a yeniden yazar (birim
ve tarayıcı testli). Konumlandırma: "restoranlar için AI destekli servis ve operasyon platformu"; bir QR menüden fazlası.

Katmanlar:

- `src/content/marketing/copy.ts` — TÜM metin (bileşenler metin içermez).
- `src/lib/marketing/` — saf ve birim testli: `plans`, `voice-demo` (durum makinesi), `motion`, `seo`, `events`, `contact`.
- `src/components/marketing/` — bölümler. Sunucu bileşenleri varsayılandır; yalnızca canlandırmalar istemcidedir:
  `hero-demo`, `voice-demo`, `product-story`, `operations-demos`, `site-header`, `reveal-observer`, `marketing-tracker`.

Sayfa statik olarak üretilir (`○ /`); uzun yükleme ekranı yoktur.

Hikâye sırası:

1. Hero
2. Nedir + nasıl çalışır (4 adım + yapışkan anlatı)
3. Sesli AI
4. QR menü + masadan sipariş
5. Mutfak + servis
6. Analitik
7. QR etiket
8. Özellikler + güven
9. Paketler
10. Demo
11. Altbilgi

## 115. Doğruluk kuralları (pazarlama)

- **Sosyal kanıt yok:** müşteri logosu, restoran / sipariş sayısı, puan ya da yorum uydurulmaz. Güven bölümü yalnızca
  ürün özelliklerini anlatır.
- **Ödeme / kâr iddiası yok:** "Masadan sipariş" denir, online ödeme denmez; hesap talebi ödeme değildir. "Sipariş
  Tutarı" gelir, kâr ya da marj değildir.
- **Sesli AI:** "5 dilde sesli konuşma" (TR / EN / DE / AR / RU). Menü arayüzü dilleri ayrı tutulur (TR / EN / DE / AR);
  Rusça menü iddiası yok.
- **Paketler:** `config/plans.ts` tablosundan türetilir (`lib/marketing/plans.ts`). Fiyat yok, "Fiyat için iletişime
  geçin" yazılır. (Sprint 20: tüm paket özellikleri uygulanıyor — §151–157.)
- **Örnek içerik:** analitik ve menü örnek verileri sayfada açıkça "örnek" olarak etiketlidir.
- **Görseller:** SVG yemek çizimleri ve temsili QR. Kiracı medyası kullanılmaz.
- **Testler:** `tests/unit/marketing.test.ts` bu kuralları metin üzerinde doğrular.

## 116. Hareket sistemi

- **Açığa çıkma:** sunucuda `data-reveal` ile işaretlenen öğeleri tek bir `RevealObserver` gözler.
  - Gizleme yalnızca satır içi `data-mk-js` bayrağı varken uygulanır: JS kapalıyken her şey görünür.
  - 4 sn emniyet animasyonu, hidrasyon hatasında içeriğin kaybolmasını önler.
- **Döngüler:** `useDemoLoop` yalnızca bölüm görünürken ve sekme açıkken ilerler; görünmeyen demo durur.
- **Hareket azaltma ve veri tasarrufu:**
  - Canlandırmalar son karede durur; hiçbir içerik gizlenmez.
  - CSS genel kuralı ve `.mk-*` animasyonları bu durumda kapatılır.
- **Sesli demo:**
  - Saf durum makinesidir (`lib/marketing/voice-demo.ts`).
  - Bir kez oynar (TR → EN) ve son karede durur.
  - Mikrofon, ses ya da AI sağlayıcısı başlatılmaz; ses çalınmaz.
- **Analitik çubukları:** yalnızca bir kez büyür. Sayılar sürekli değişmez.
- **Ağır animasyon kütüphanesi yok:** yalnızca CSS ve IntersectionObserver kullanılır.

## 117. Erişilebilirlik ve tema

- **Başlıklar:** tek H1 (hero); bölümler H2, kartlar H3. Semantik header, nav, main, section ve footer kullanılır;
  "İçeriğe geç" bağlantısı var.
- **Canlandırmalar:** `aria-hidden` ile işaretli. Aynı bilgi metin olarak da var (hero özeti `sr-only`, sesli demo
  etiketi, grafik özeti).
- **Kontrast:** birincil CTA `#c2410c` üzerinde beyaz (5,2:1). Pasif hikâye adımları soluklaştırılmaz; etkin adım
  vurgu çizgisiyle belirtilir.
- **Mobil menü:** `aria-expanded` ile durumu bildirir, Escape ile kapanır, 44 px dokunma hedefleri.
- **Koyu / açık ritim:** `.mk-dark` / `.mk-light` aynı token adlarını yeniden tanımlar (koyu bölümde açık demo formu
  dahil); bileşen sınıfları değişmez.

## 118. SEO ve dönüşüm

- **Meta veriler:** `lib/marketing/seo.ts`; başlık "MasaNova AI | Yapay Zeka Destekli QR Menü ve Restoran Yönetimi".
  Açıklama, canonical `/`, OG / Twitter ve `opengraph-image` (next/og, derleme anında PNG; ikili dosya yok).
- **JSON-LD:** Organization, WebSite ve SoftwareApplication. `aggregateRating` / `offers` yok; `</script>` ile U+2028 /
  U+2029 kaçışlanır.
- **Demo formu:** mevcut demo talep formu ve eylemi (Zod + bot tuzağı + hız sınırı); ikinci bir form yok.
- **WhatsApp:** yalnızca `NEXT_PUBLIC_CONTACT_WHATSAPP` ayarlıysa gösterilir.
- **Olaylar:** `MARKETING_*` olayları tarayıcı içi CustomEvent'tir (`masanova:marketing`). Üçüncü taraf izleyici yok;
  kalıcı kayıt sonraya bırakıldı.

## 119. Performans

Ana sayfa JS'i giriş sayfasınınkinden az (≈524 KB ↔ 537 KB sıkıştırılmamış; büyük parçalar ortak Next / React
çalışma zamanı). Pazarlama bileşenleri sesli asistan, panel ya da QR menü kodunu içe aktarmaz. Tarayıcı testi betik
içeriğinde `getUserMedia` / `AudioWorklet` / asistan uç noktası olmadığını doğrular.

Yerel ölçüm (390 px, kısıtlama YOK, Lighthouse değil): LCP ≈ 570 ms, CLS 0. Gerçek ağ / Lighthouse ölçümü yayın
öncesi yapılmalı.

## 120. İşletme Danışmanı — mimari (Sprint 15)

`/panel/ai/danisman` (AI bölümünde "Sesli Asistan" yanında ayrı sekme) **salt okunur**:

- fiyat, menü, istasyon yönlendirmesi, personel, ayar ya da paket DEĞİŞTİRMEZ;
- modele araç verilmez (`complete({ tools: [] })`);
- yazdığı tek tablo kendi içgörü kayıtları ve AI kullanım ölçümüdür.

İki aşamalı akış:

```
Sprint 12 analitik sorguları (toplu) ─┐
danışmana özgü toplu sorgular ───────┴→ AdvisorFacts (server/services/advisor/facts.service.ts)
   → deterministik kurallar (lib/advisor/rules/*) → aday içgörüler (olgular + "nasıl hesaplandı" satırları,
     güven, önem, izinli eylemler)
   → [isteğe bağlı, elle "Analizi Yenile"] AI açıklaması (aynı sağlayıcı kaydı; danışmana özel istem)
   → doğrulama (lib/advisor/validate.ts) → geçerse AI metni, değilse deterministik şablon (lib/advisor/templates.ts)
```

Danışmana özgü toplu sorgular (hepsi SQL'de, ham satır belleğe alınmaz):

- 2 saatlik pencerelerde medyan hazırlama süresi;
- pencere × istasyon fiş süresi;
- çok istasyonlu siparişlerde son hazır olan istasyon;
- bölge bazında servis yanıt medyanı;
- son 28 tam günün günlük sipariş sayısı (yerel gün).

Kiracı / şube / saat dilimi / para birimi her zaman `resolveAnalyticsContext` (oturum kapsamı) üzerinden gelir.

## 121. Kurallar ve eşikler

Eşikler tek yerde tutulur (`lib/advisor/thresholds.ts`): en az örneklem (her iki dönem), en az göreli ve en az mutlak
değişim. Sıfır taban → yüzde yok, içgörü yok. Kurallar ve kategorileri:

| Kategori | Kurallar |
| --- | --- |
| SALES | sipariş adedi, ortalama sipariş, gün anomalisi (medyan / MAD, \|z\| ≥ 3,5) |
| OPERATIONS | ret oranı (yüzde puanı), medyan hazırlama |
| KDS | yoğun saat penceresi (+ penceredeki en yavaş istasyon), istasyon fiş süresi, uzun kuyruk (p90 / medyan), çok istasyonlu darboğaz |
| SERVICE | servis yanıt medyanı |
| TABLES | bölgeler arası yanıt farkı, bölge sipariş değişimi |
| MENU | ürün ivmesi (arşivlenmiş / silinmiş ürün düşüşü bastırılır), yüksek adet / görece düşük katkı ve tersi |
| AI_USAGE | bas-konuşa düşme oranı, hata oranı, konuşma sayısı |

- **Bağımsızlık:** her kural bağımsız test edilir; biri hata verirse diğerleri çalışmaya devam eder.
- **Sıralama:** önem × güven × büyüklük (log ölçekli); en fazla 10 içgörü gösterilir, ilk 4'ü "öne çıkanlar".
- **Güven (deterministik; AI belirlemez):**
  - Değerler: YÜKSEK / ORTA / SINIRLI.
  - Ölçüt: en küçük örneklem eşiğin ≥ 3 katıysa YÜKSEK, ≥ 1,5 katıysa ORTA.
  - Tek dönemli kurallarda (karşılaştırma tabanı yok) en fazla ORTA.
  - p90 / medyan ≥ 3 ise bir seviye düşer.
- **Karşılaştırma:** önceki eşdeğer dönem (Sprint 12; süren dönemde aynı geçen süre). Hafta içi / hafta sonu
  mevsimselliği modellenmez (bilinen sınır).

## 122. AI açıklama katmanı ve doğrulama

- **İstem:** danışmana özel (`lib/advisor/prompt.ts`), müşteri asistanından TAMAMEN AYRI — konuşma geçmişi ve araç
  yok.
- **Modele giden:** yalnızca biçimlendirilmiş olgular ve izinli eylem metinleri. Ham tablo, müşteri verisi ya da
  konuşma içeriği gönderilmez.
- **Çağrı sıklığı:** tek istekte gösterilen tüm içgörüler açıklanır.
- **Doğrulama** — aşağıdakilerden biri varsa açıklama reddedilir ve kart deterministik şablonla gösterilir; aynı olgular
  için tekrar ücretli istek yapılmaz (`explanationModel = "rejected:<neden>"`):
  - olgu / şablon metninde OLMAYAN bir sayı;
  - kâr / marj / gelir / ciro iddiası;
  - personel sıralaması, işe alma / işten çıkarma;
  - neden-sonuç iddiası ("sayesinde", "artırdı" vb.);
  - kesin fiyat önerisi, "menüden kaldırın";
  - değişiklik yaptığı iddiası;
  - HTML ya da aşırı uzunluk.
- **Yedek:** sağlayıcı yoksa / hata verirse danışman deterministik çalışmaya devam eder.
- **Geliştirme / test:** `AI_PROVIDER=mock` deterministik açıklayıcı kullanır.

## 123. Kalıcılık, yeniden kullanım, önbellek

`AdvisorInsight` kaydının kimliği (kiracı, kapsam [şube | "all"], aralık, tür, özne) üzerinden tutulur. Kapsam
tutarlılığı CHECK ile, kiracı FK ile korunur; şube için bileşik FK vardır.

- **factHash:** olgular değişmediyse önceki AI açıklaması yeniden kullanılır. Aynı kiracıda başka kapsamda aynı
  olgular açıklanmışsa o açıklama kopyalanır ve AI çağrılmaz.
- **materialHash:** yön + kaba büyüklük kovası + güven. Kapatılan içgörü küçük dalgalanmada kapalı kalır; önemli
  değişimde yeniden "Yeni" olur.
- **Durumlar:**
  - YENİ → GÖRÜLDÜ: kullanıcı sayfayı görüntüleyince (yenileme isteği görmüş saymaz).
  - KAPATILDI: kullanıcı kapatınca.
  - Faydalı / faydalı değil geri bildirimi.
- **Önbellek:** deterministik adaylar 5 dk tutulur ("şimdi" 5 dk'ya yuvarlanır). "Analizi Yenile" önbelleği atlar ve
  taze sonucu normal anahtara yazar.
- **Hız sınırı:** `advisor.refresh` kiracı başına 6 / saat; Redis yokken güvenli ret.
- **Kullanım ölçümü:** AI kullanımı `AiUsageKind.ADVISOR` olarak kaydedilir; müşteri sesli AI özetlerine karışmaz.
- **Metrikler:**
  - `advisor.generated`, `advisor.cache_hit`
  - `advisor.explained`, `advisor.explanation_reused`
  - `advisor.explanation_rejected`, `advisor.provider_failure`, `advisor.fallback`
  - Loglarda yalnızca sayı ve süre; olgu dökümü yok.

## 124. Yetki, paket, gizlilik

- **Paket kapısı:** `business_advisor` (`ai_business_advisor`, AI paketi), sunucuda UYGULANIR. Sesli AI'dan bağımsız
  ticari özellik; bugün ikisi aynı pakette.
- **Roller:**
  - `advisor.view` / `advisor.manage`: sahip ve şube müdürü (görüntüleme, yenileme, kapatma, geri bildirim).
  - Garson / kasiyer / mutfak / bar → 404.
- **Destek modu:** görüntüler, hiçbir şey yazmaz; eylemler 404.
- **Gizlilik:** müşteri kimliği, IP, QR belirteci, konuşma metni ve personel adı hiçbir sorguda seçilmez. AI kullanım
  içgörüleri yalnızca toplu sayılardır; AI → satış nedenselliği iddia edilmez.
- **Genel bakış:** panelde küçük bir "N yeni içgörü" kartı gösterilir.

## 125. Testler (Sprint 15)

- **Birim:**
  - `tests/unit/advisor.test.ts` — eşikler, sıfır taban, her kural, güven, özet, şablonlar, doğrulama.
  - `tests/unit/advisor-authorization.test.ts` — roller, destek modu, hız sınırı.
- **Entegrasyon (Neon + mock açıklayıcı):** `tests/integration/advisor.test.ts` — 16 madde + güvenlik.
- **Tarayıcı:** `tests/e2e/e2e-sprint15.cjs` — sunucuyu AI kapalı / mock AI ile yeniden başlatır.

## 126. Müşteri kimliği ve CRM — mimari (Sprint 16)

- **İlke:** kimlik TAMAMEN isteğe bağlıdır. Menü, sipariş, servis talebi ve sesli AI kimliksiz çalışır. Parmak izi,
  IP / cihaz eşleştirmesi ya da gizli hesap YOKTUR.
- **Veri modeli** (kiracıya özel; bileşik yabancı anahtarlar `(x, tenant_id) → (id, tenant_id)`):
  - `customers` — ad (isteğe bağlı), telefon / e-posta + normalize alanlar (`+90…` E.164, küçük harf e-posta),
    doğrulama zamanları, kaynak (`QR_OPT_IN`, `ORDER_CHECKOUT`, `LOYALTY_JOIN`, `MANUAL_STAFF`), personel notu
    (≤ 500, CHECK), silme talebi zamanı, son görülme.
  - `customer_verified_contacts` — kiracı içinde benzersiz `(tenant, channel, value)`; YALNIZCA doğrulanmış iletişim.
  - `customer_consents` — ekleme-yalnız, sürümlü onay kayıtları (CHECK: GRANTED ↔ granted_at, REVOKED ↔ revoked_at).
  - `customer_sessions` — müşteri oturumları (yalnızca SHA-256 özeti).
  - `contact_verifications` — bekleyen doğrulama (kod özeti, deneme sayısı, son geçerlilik, tek kullanım).
  - `orders.customer_id`, `table_service_requests.customer_id` — isteğe bağlı ilişki.
- **Kimlik kanıtı:** 256 bit opak belirteç, `mn_customer` httpOnly çerezi (SameSite=Lax, üretimde Secure, 180 gün,
  kiracı alan adına özel). Sunucu yalnızca özetini tutar; oturumun kiracısı isteğin kiracısıyla eşleşmezse yok sayılır.
  `customerId` / `tenantId` istemciden ASLA kabul edilmez.
- **Masa bağlamından ayrıdır:** müşteri farklı masalarda oturabilir; her sipariş / servis talebi yine geçerli QR
  belirteci ister. Kimlik masa işlemini tek başına yetkilendirmez. Aynı masadaki yeni tarayıcı kimlik devralmaz.
- **Kod:** `src/lib/crm/*` (saf kurallar), `src/server/crm/*` (oturum, doğrulama, müşteri, sadakat, panel sorguları),
  `src/server/actions/customer.actions.ts` (QR), `src/server/actions/crm.actions.ts` (panel).

## 127. Katılım, doğrulama, onay

- **Akış:** sipariş sonrası sakin davet ("Sadakat avantajlarından yararlanmak ister misiniz?" · Bilgilerimi ekle /
  Şimdi değil — açılır pencere değil; "Şimdi değil" bu tarayıcıda 30 gün gizler) → `/t/<token>/hesabim` → telefon /
  e-posta → (doğrulama açıksa kod) → isteğe bağlı ad → onaylar → profil. Menüde küçük "Puan kazan" / "N puan"
  bağlantısı (yalnızca sadakat açıksa ya da kimlik varsa).
- **Doğrulama sağlayıcısı soyutlaması** (`src/server/crm/verification.ts`):
  - Varsayılan KAPALI → katılım "doğrulanmamış" kaydedilir, panelde ve müşteriye açıkça işaretlenir, hiçbir profile
    BAĞLANMAZ (her katılım yeni profil). Sahte OTP yoktur.
  - `CONTACT_VERIFICATION_PROVIDER=mock` yalnızca test / geliştirme; üretim derlemesinde yok sayılır.
  - Kod HMAC özeti olarak saklanır, loglanmaz; 10 dk, 5 deneme, tek kullanım; gönderim hız sınırlı.
  - Doğrulanmış iletişim tekrar gelirse aynı kiracıdaki müşteriye bağlanır (yinelenen yok; mevcut ad korunur).
- **Onaylar:** PRIVACY (katılım için zorunlu), LOYALTY, MARKETING_EMAIL / SMS / WHATSAPP. Pazarlama kutuları
  varsayılan kapalı, ilgili iletişim yoksa seçilemez. Metin + sürüm tek yerde: `src/config/consent.ts`
  (`CONSENT_VERSION`). Metin değişince sürüm artar; eski kayıtlar kendi sürümünü korur.
  - Değişiklik yeni satırdır (geri alma anında geçerli, geçmiş silinmez). Aynı durumu tekrar yazmak satır üretmez.
  - Sipariş durumu bildirimi (operasyonel) pazarlama onayı DEĞİLDİR.
  - Personel onay VEREMEZ; müşterinin talebiyle yalnızca pazarlama onayını geri alabilir (kaynak `MANUAL_STAFF`).
- **Müşteri profili:** ad güncelleme, onay yönetimi, puan, bu cihazda çıkış, veri silme talebi. İletişim maskeli
  gösterilir; doğrulama yokken iletişim değişikliği müşteriye kapalıdır (personel üzerinden).

## 128. CRM paneli

- `/panel/musteriler`: metrikler (kayıtlı müşteri, tekrar gelen = ≥ 2 servis edilmiş sipariş, son 30 gün kayıtlı
  müşteri siparişi + tüm siparişlere oranı, aktif sadakat üyesi), ad / telefon / e-posta araması (normalize alanlar),
  liste (iletişim HER ZAMAN maskeli, son ziyaret, sipariş sayısı, "Toplam Sipariş Tutarı" = servis edilmiş
  siparişlerin toplamı, sadakat durumu, kanal başına pazarlama: İzin var / İzin yok / Geri alındı).
- `/panel/musteriler/[id]`: profil (tam iletişim yalnızca yetkili sahip / müdüre), onaylar + geçmiş, sipariş
  geçmişi, sadakat defteri + manuel düzeltme, personel notu, silme talebi uyarısı. Teknik kimlik gösterilmez.
- `/panel/musteriler/yeni`: elle müşteri (kaynak `MANUAL_STAFF`, onaysız).
- Otomatik birleştirme, CSV içe / dışa aktarma, kampanya gönderimi YOKTUR.
- Sipariş ayrıntısı yalnızca ilişkili müşterinin gösterim adını gösterir. KDS, servis panosu, analitik DTO'ları ve
  İşletme Danışmanı müşteri iletişimi almaz. Sesli AI'ya CRM profili verilmez.

## 129. Sadakat çekirdeği

- `loyalty_settings` (kiracı başına; varsayılan KAPALI, kural boş, kazanım anı SERVED) · `loyalty_accounts`
  (LOYALTY onayıyla açılır / geri alınınca pasif) · `loyalty_ledger` (EARN / REDEEM / ADJUSTMENT / EXPIRE; bu sürümde
  EARN + manuel ADJUSTMENT; Sprint 18: REDEEM + REVERSAL).
- **Kural:** "1 puan için gereken tutar" (`minor_per_point`); puan = ⌊sipariş toplamı / kural⌋. İşletme belirleyene
  kadar program açılamaz — ticari politika uydurulmaz.
- **Kazanım:** TEK merkezi nokta `applyOrderTransition` → `earnLoyaltyInTx` (aynı transaction). Yalnızca ayarlı anda
  (SERVED önerilen / ACCEPTED), sipariş anında tanınan + aktif üye müşteri için. REJECTED / CANCELLED / anonim asla.
- **İdempotent:** `UNIQUE (tenant_id, order_id, type)` + `createMany … skipDuplicates` → yeniden deneme / yarış / tekrar
  olay çift puan üretmez. Bütünlük: CHECK (EARN ⇒ sipariş + pozitif puan; puan ≠ 0) ve tetikleyici (siparişin
  müşterisi = hesabın müşterisi). Defter → sipariş ilişkisi CASCADE (uygulamada sipariş silinmez; yalnızca kiracı /
  test temizliği).
- **Bakiye** defterden türetilir; istemci bakiyesine güvenilmez. Manuel düzeltme hesap satırı kilidiyle bakiyeyi eksiye
  düşüremez, gerekçe zorunlu, denetlenir.
- **Geri alma (Sprint 18):** reddedilen / iptal edilen siparişin kazanım ve kullanım satırları REVERSAL ile otomatik, tek kez geri alınır (§140).

## 130. Yetki, güvenlik, gizlilik, saklama

- **Roller:** `crm.view` / `crm.manage` / `loyalty.view` / `loyalty.manage` → sahip + şube müdürü. Kasiyer
  (eski `customers.view` kaldırıldı), garson, mutfak, bar → 404 (bölüm `layout.tsx` denetimi loading sınırının dışında).
- **Destek modu:** salt okunur; iletişim her zaman maskeli (`0539 *** ** 25`, `a***@mail.com`); eylemler 404.
- **Denetim:** `CUSTOMER_CREATED`, `CUSTOMER_UPDATED`, `CUSTOMER_DELETION_REQUESTED`, `CONSENT_CHANGED`,
  `LOYALTY_SETTINGS_UPDATED`, `LOYALTY_ADJUSTMENT` — metadata'da telefon / e-posta YOK (iç referans + kanal adları).
- **Hız sınırı:** `crm.join.ip`, `crm.join.table`, `crm.verify.send.contact`, `crm.verify.send.ip`,
  `crm.verify.check.ip`, `crm.profile.ip` (Redis yoksa bellek yedeği).
- **CSRF:** tüm değişiklikler Server Action (Next.js Origin denetimi).
- **Hassas profil yok:** din, sağlık, siyaset, etnik köken alanı yok; AI'daki alerji / diyet konuşmaları CRM'e yazılmaz.
- **Şifreleme:** telefon / e-posta bu sürümde uygulama düzeyinde şifrelenmez; Neon'un disk şifrelemesi + TLS +
  erişim denetimi varsayılır. Gelecek yol: zarf şifreleme (KMS anahtarı) + arama için anahtarlı HMAC özet sütunları
  (`phone_hmac`, `email_hmac`); zayıf özel kripto UYDURULMAZ.
- **Saklama (temel):** profil ve onaylar silme talebine kadar; onay geçmişi kanıt olarak tutulur; sadakat defteri
  hesapla birlikte; sipariş ilişkileri otomatik silinmez. Doğrulama kayıtları 24 saatte temizlenir.
- **KVKK / GDPR hazırlığı (uyum İDDİASI DEĞİL):** onay kanıtı (tür, durum, kaynak, sürüm, zaman), geri alma, müşterinin
  kendi verisine erişimi (Hesabım), silme talebi temeli (izinler geri alınır, oturumlar kapanır, işletmeye işaretlenir).
  Anonimleştirme iş akışı ve nihai hukuki metinler sonraki adım.

## 131. Testler (Sprint 16)

- **Birim:** `tests/unit/crm.test.ts` (normalizasyon, maskeleme, onay geçişleri / sürüm, puan, defter, tekrar gelen,
  oturum / kod kanıtı, yetki matrisi), `tests/unit/crm-authorization.test.ts` (roller, destek modu, oturumsuz / başka
  kiracı oturumu, istemci kimliği yok sayılır, idempotent kazanım); destek modu taramasına `crm.actions` eklendi.
- **Entegrasyon (Neon):** `tests/integration/crm.test.ts` — 18 zorunlu madde + DB kısıtları, mock doğrulama, silme talebi.
- **Tarayıcı:** `tests/e2e/e2e-sprint16.cjs` (regresyon id 16) — üretim derlemesinde doğrulanmamış katılım yolu.

## 132. Rezervasyon — mimari (Sprint 17)

- **Kavramlar ayrıdır:** Rezervasyon (zaman + kişi + misafir), Masa ataması (`reservation_tables`), Walk-in (kaynak
  `WALK_IN`, doğrudan `SEATED`), Oturan ziyaret (`SEATED`). Rezervasyon sipariş DEĞİLDİR; QR / sipariş akışı
  rezervasyondan bağımsız çalışır.
- **Veri modeli** (kiracıya özel; bileşik yabancı anahtarlar):
  - `reservation_settings` (kiracı; varsayılan KAPALI) — süre, saat aralığı, en erken / en ileri, kişi sınırları,
    temizlik payı, otomatik onay, online açık, iptal sınırı, "gelmedi" bekleme payı (CHECK kısıtlı).
  - `branch_opening_hours` (şube, ISO hafta günü 1–7, yerel dakika; gün başına ≤ 3 aralık; gece yarısını geçen saat yok).
  - `reservation_blackouts` (şube, UTC [başlangıç, bitiş)).
  - `table_combinations` + `table_combination_tables` (yöneticinin tanımladığı birleşimler).
  - `dining_tables.capacity` (mevcut) + `capacity_min` + `reservable`.
  - `reservations` — publicId (128 bit), yönetim belirteci özeti + nonce, isteğe bağlı `customer_id`, misafir adı /
    telefon / e-posta, kişi, `starts_at` / `ends_at` (UTC), süre + o anki pay, durum, kaynak, bölge tercihi, özel istek
    (≤ 300), iç not (≤ 500), `overridden`, idempotency anahtarı özeti + istek özeti, zaman damgaları.
  - `reservation_tables` — masa doluluğu `[starts_at, blocked_until)` + `active`.
  - `reservation_status_history` — ekleme-yalnız (UPDATE tetikleyiciyle engellenir).
- **Durum makinesi** (`src/lib/reservations/status.ts`, tek kaynak): PENDING → CONFIRMED / CANCELLED; CONFIRMED →
  SEATED / CANCELLED / NO_SHOW; SEATED → COMPLETED / CANCELLED; son durumlar kapalı. Son duruma geçişte masalar
  serbest kalır (`active = false`; satır geçmiş için saklanır).
- **Onay modeli:** otomatik onay AÇIKKEN online rezervasyon yalnızca kilit altında masa bulunduğunda `CONFIRMED`;
  kapalıyken `PENDING` (masa yine ayrılır, personel onaylar). Personel rezervasyonu `CONFIRMED`.

## 133. Uygunluk motoru ve çift rezervasyon engeli

- **Saf, deterministik** (`src/lib/reservations/availability.ts`, AI yok): girdi şube masaları + birleşimler +
  pencerede etkin doluluk + istek bloğu + kişi + bölge tercihi → aday atamalar.
  - Tek masa: tercih edilen bölge önce, sonra EN KÜÇÜK yeterli kapasite (2 kişiye 8'lik masa verilmez), sonra sıra / ad.
  - Tek masa yoksa yalnızca TANIMLI birleşimler (en az fazla kapasite, en az masa). Dinamik birleştirme yok.
  - Kapasitesi boş / rezervasyona kapalı / pasif masa ve `capacity_min` üstü atanmaz. Ad kapasite sayılmaz.
- **Aralıklar yarı-açık.** Blok = başlangıç + süre + temizlik payı; pay her iki yönde korunur.
- **Saatler:** açılış aralığında `slot_interval` adımla; rezervasyon kapanıştan ÖNCE biter. Public uygunluk yalnızca
  gerçekten masa bulunan saatleri döner. Önbellek YOK (gün başına tek doluluk + tek kapalı dönem sorgusu).
- **Çift rezervasyon engeli (3 katman):**
  1. `pg_advisory_xact_lock(hashtextextended('reservation-branch:<şube>'))` — aynı şubede oluşturma / masa değiştirme
     sıraya girer (PgBouncer transaction modunda da çalışır).
  2. Kilit altında politika + saat + kapalı dönem + doluluk YENİDEN hesaplanır (tarayıcı uygunluğu yalnızca bilgi).
  3. `reservation_tables` üzerinde `EXCLUDE USING gist (table_id WITH =, tsrange(starts_at, blocked_until, '[)') WITH &&)
     WHERE active` (btree_gist) — kod hatası olsa bile çakışan etkin satır yazılamaz.
  Ölçüldü: tek masaya 10 eşzamanlı istek → tam 1 başarı.
- **Kural aşma (override):** yalnızca sahip / müdür, açıkça işaretlenir; zaman penceresi, açılış saati, kapalı dönem,
  kişi ve kapasite kurallarını aşar — masa çakışmasını ASLA. `RESERVATION_OVERRIDE` denetimi + `overridden` bayrağı.
- **Idempotency:** istemci opak anahtar gönderir; `(tenant, sha256(anahtar))` benzersiz + istek özeti. Aynı anahtar +
  aynı içerik → aynı rezervasyon ve AYNI yönetim bağlantısı (belirteç HMAC(sır, nonce) ile yeniden türetilir; ham
  belirteç saklanmaz); değişen içerik → ret.

## 134. Public rezervasyon ve yönetim bağlantısı

- **Rota:** kiracı alan adında `/rezervasyon` (proxy → `/site/rezervasyon`); panel altında değil, hesap gerekmez.
  Kiracı yalnızca host'tan, şube SLUG ile kiracı içinde; masası ya da açılış saati olmayan şube listelenmez.
- **Akış (mobil öncelikli):** şube → tarih çipleri (+ takvim girişi) → kişi (− / +) → sunucudan gelen saatler →
  bölge tercihi (garanti değil) → ad + telefon (+ isteğe bağlı e-posta, özel istek ≤ 300) → özet → onay.
  Büyük grup: "Bu kişi sayısı için restoranla iletişime geçin." + şube telefonu. Bal tuzağı alanı.
- **Son onay:** sunucu kilit altında yeniden hesaplar; dolduysa "Bu saat az önce doldu. Size yakın saatleri
  gösterebiliriz." + aynı gün gerçekten müsait en yakın 4 saat.
- **Yönetim bağlantısı:** `/rezervasyon/y/<256 bit belirteç>`; sunucuda yalnızca özeti; kiracıyla eşleşmeli; görüntüle
  + iptal (iptal sınırı ayarı, 0 = rezervasyon saatine kadar). İç not / masa / müşteri kimliği gösterilmez;
  `no-referrer`. Ham belirteç loglanmaz / denetime yazılmaz.
- **Hız sınırı:** uygunluk `res.availability.ip`; oluşturma `res.book.ip` + `res.book.contact` (telefon) +
  `res.book.branch`; yönetim `res.manage.ip`.

## 135. Personel paneli, walk-in, oturtma

- `/panel/rezervasyonlar`: Bugün / Yarın / gün gezintisi, Liste (saat, misafir, maskeli telefon, kişi, masa / bölge,
  durum, kaynak, "N dk gecikti" — otomatik iptal YOK, işlem düğmeleri durum makinesinden), Zaman çizelgesi (bölgelere
  göre masalar × saat; sürükle-bırak yok; dar ekranda kendi içinde kayar), Takvim (kütüphanesiz ay görünümü).
- `/panel/rezervasyonlar/[id]`: misafir (tam iletişim yetkiliye; destekte maskeli), CRM bağlantısı ya da "Anonim
  rezervasyon", özel istek (düz metin), masa + masa değiştirme (sahip / müdür; öneriler ya da kural aşmalı elle seçim),
  durum geçmişi, iç not.
- `/panel/rezervasyonlar/yeni`: aynı motor; kaynak Telefon / Personel / Diğer.
- **Walk-in Ekle:** kişi + isteğe bağlı ad + bölge → şu an boş masa → `SEATED`, kaynak `WALK_IN`.
- **Masaya Al:** CONFIRMED → SEATED. Masalar sayfası oturan rezervasyonu (ad + kişi) gösterir; QR / sipariş normal
  çalışır, masadaki siparişler rezervasyon müşterisine otomatik BAĞLANMAZ (yalnızca o tarayıcının müşteri oturumu).
- `/panel/rezervasyonlar/ayarlar`: kurallar, şube açılış saatleri, masa listesi (kapasite uyarısı), birleşimler,
  kapalı dönemler.
- **Analitik:** Masalar sekmesinin altında rezervasyon özeti (toplam, masaya alınan, iptal, gelmedi, ortalama kişi,
  saate göre beklenen kişi) — yalnızca toplamlar. İşletme Danışmanı'na bu sprintte bağlanmadı.

## 136. Yetki, gizlilik, saat dilimi, saklama

- **Roller:** `reservations.view` (sahip, müdür, garson, kasiyer), `reservations.manage` (sahip, müdür, garson),
  `reservations.override` (sahip, müdür; masa değiştirme + kural aşma), `reservations.settings` (sahip, müdür).
  Mutfak / bar → 404 (bölüm `layout.tsx`). Destek modu salt okunur, iletişim maskeli.
- **Şube görünürlüğü:** personel → şube ataması henüz yok; görünürlük kiracı düzeyinde, şube seçimi filtredir.
- **CRM / onay:** rezervasyon iletişimi operasyoneldir — pazarlama izni üretmez, CRM profili oluşturmaz. Yalnızca o
  tarayıcıda zaten tanınan müşteri (Sprint 16 oturumu) bağlanır. Bu sprintte rezervasyonda pazarlama kutusu sunulmaz.
- **Gizlilik:** rezervasyon verisi KDS'e, servis panosuna, sesli AI'ya, AI konuşma kayıtlarına gitmez. Denetim
  metadata'sında telefon / e-posta / özel istek / belirteç yok. Notlar / istekler React metni (HTML işlenmez).
- **Saat dilimi:** tarih / saat ŞUBE saat diliminde seçilir, UTC saklanır, yerel gösterilir. DST: ileri alınan saatteki
  yerel zaman yoktur (slot üretilmez, personel girişi reddedilir); geri alınan saatte ilk geçiş seçilir, slot bir kez.
- **Bildirim kancası:** `RESERVATION_CONFIRMED` / `RESERVATION_REMINDER` olayları yalnızca loglanır (SMS / e-posta YOK).
- **Saklama:** tamamlanan / iptal / gelmedi rezervasyonlar ve geçmişleri otomatik SİLİNMEZ. Gelecekte: kişisel alanların
  belirli süre sonra anonimleştirilmesi (ad / telefon / e-posta), toplam sayıların korunması.
- **Gelecek:** depozito / ön provizyon / online ödeme (Sprint 19), SMS / e-posta hatırlatma, bekleme listesi, şubeye özel
  kural geçersiz kılma, gece yarısını geçen açılış saatleri.

## 137. Testler ve performans (Sprint 17)

- **Birim:** `tests/unit/reservations.test.ts` (aralık, süre, pay, en iyi masa, birleşim, saatler, kapalı dönem, ileri
  tarih, kişi sınırı, durumlar, idempotency, belirteç, saat dilimi, DST), `tests/unit/reservation-authorization.test.ts`;
  destek modu taramasına `reservation.actions` eklendi.
- **Entegrasyon (Neon):** `tests/integration/reservations.test.ts` — 22 zorunlu madde + güvenlik (10'lu yarış dahil).
- **Yük:** `tests/load/reservations.load.test.ts` (100 masa + 10.000 rezervasyon) → `tmp/load/reservations.json`.
- **Tarayıcı:** `tests/e2e/e2e-sprint17.cjs` (regresyon id 17).

## 138. Promosyonlar — mimari (Sprint 18)

- **Sunucu yetkilidir:** tarayıcı yalnızca kupon kodu / ödül seçimi + sepet referanslarını gönderir. Uygunluk, indirim
  ve toplam sipariş gönderiminde YETKİLİ katalog fiyatlarıyla sunucuda hesaplanır; istemciden gelen indirim / toplam
  alanları şemada yoktur (atılır). Para tamsayı kuruş, yüzde baz puan (1000 = %10); kayan nokta yok.
- **Türler:** `FIXED_AMOUNT`, `PERCENTAGE` (isteğe bağlı tavan), `FREE_ITEM` (yapılandırılmış ürün sepette olmalı,
  en ucuz eşleşen satırın BİR birimi; adet değişmez), sadakat ödülü (aynı türler, puanla).
- **Veri modeli:** `coupons` (+ `coupon_products`, `coupon_categories`), `coupon_redemptions` (değiştirilemez; sipariş
  başına tek), `loyalty_rewards`, `order_promotions` (siparişin değiştirilemez promosyon KOPYASI: kod, ad, tür,
  indirim, harcanan puan, ücretsiz ürün adı; sipariş başına tek → yığma veritabanında da imkânsız),
  `orders.discount_minor` (CHECK: toplam = ara toplam − indirim ≥ 0), `campaigns`. Tümü kiracıya özel bileşik FK.
- **Kod:** kırpılır, büyük harfe çevrilir, Türkçe harfler ASCII'ye iner, `^[A-Z0-9_-]{3,24}$`; kiracı içinde benzersiz.
  Kod kiracıyı tanımlamaz; her zaman istek kiracısında çözülür.
- **Kod:** `src/lib/promotions/*` (saf hesap, zaman penceresi, kitle, kullanım, segment, şablon), `src/server/promotions/*`
  (çözümleyici, yönetim, form), `promotion-public.actions.ts` (QR önizleme), `campaign.actions.ts` (panel).

## 139. Hesaplama, kurallar, eşzamanlılık

- **Sıra:** etkin mi → şube → zaman penceresi (başlangıç / bitiş UTC; gün + saat penceresi ŞUBE yerel saatinde, DST
  dahil) → kitle (`ANYONE` / `IDENTIFIED` / `LOYALTY_MEMBER` / `REPEAT_CUSTOMER`) → kullanım sınırı → en az sepet →
  kapsam (tüm sepet / ürün / kategori + üst kategoriler; canlı menü ilişkisi) → indirim ≤ ara toplam.
- **Yığma yok:** siparişte tek kupon YA DA tek ödül (`exclusivePromotion` + `order_promotions.order_id` benzersiz).
- **Kullanım sınırı:** toplam ve kişi başı. Reddedilen / iptal edilen siparişin kullanımı sayılmaz. Kişi başı sınır
  yalnızca tanınan müşteride uygulanabilir (anonim kullanım güvenilir biçimde ayırt edilemez); işletme kuponu
  "yalnızca kayıtlı müşteri" yapabilir.
- **Atomiklik:** sipariş + promosyon kopyası + kupon kullanımı / puan düşümü TEK transaction. Promosyon gönderim anında
  geçersizse sipariş OLUŞMAZ (`promotion_rejected`), hiçbir şey tüketilmez. Kupon satırı `FOR UPDATE` (son kullanım
  hakkı tek kez), sadakat hesabı `FOR UPDATE` (aynı puan iki kez harcanamaz). Ölçüldü: bakiye 500 / ödül 500 ile iki
  eşzamanlı sipariş → tam 1 başarı.
- **Idempotency:** promosyon isteği istek özetine dahil; aynı anahtar + aynı içerik → aynı sipariş ve aynı indirim
  (puan iki kez düşmez); aynı anahtar + farklı promosyon → ret.
- **Önizleme:** sepette "Uygula" yalnızca TAHMİN üretir (tüketim yok); sepet değişince sunucuda yeniden hesaplanır.
  Geçersiz kod yanıtı nötrdür ("Kupon geçerli değil.") — başka şube / kiracı / arşiv ayrımı sızdırılmaz.
  Hız sınırı: `promo.check.table` + `promo.check.ip`.

## 140. Sadakat: kullanım ve geri alma

- **REDEEM:** ödül kullanımı siparişe bağlı eksi puan satırı (+ ödül referansı); sipariş başına tek.
- **REVERSAL:** sipariş REJECTED / CANCELLED olduğunda o siparişin EARN ve REDEEM satırları için YENİ satır
  (`reverses_entry_id` benzersiz → tek kez; tetikleyici tutarın tam ters, hesabın aynı olduğunu doğrular). Eski satırlar
  DEĞİŞMEZ (`loyalty_ledger` UPDATE tetikleyiciyle engellenir). Merkezi nokta: `applyOrderTransition`.
- Kazanılmış puan geri alınınca bakiye eksiye düşebilir; bu durumda yeni ödül alınamaz (bilinen davranış).
- Bakiye her zaman defterden. Kazanım net tutar (indirim sonrası) üzerinden hesaplanır.

## 141. Kampanyalar, segmentler, onay

- Kampanya = taslak + segment + kanal (+ isteğe bağlı kupon) + düz metin şablon. Durum `DRAFT` / `READY` / `ARCHIVED`;
  "READY" yalnızca işarettir — **gönderim YOK**, "gönderildi" denmez. READY anında yalnızca kitle SAYILARI saklanır.
- **Segmentler (deterministik):** tüm izinliler, sadakat üyeleri, tekrar gelen (≥ 2 servis), 30 gündür gelmeyen,
  sık gelen (≥ 5 servis), dil TR / EN. Doğum günü alanı olmadığı için doğum günü segmenti yok; hassas çıkarım yok.
- **Onay filtresi:** kanal ↔ GÜNCEL izin (`MARKETING_EMAIL` / `SMS` / `WHATSAPP`); izin hiç verilmemiş ya da geri
  alınmışsa hariç; iletişim yoksa hariç; silme talebi olan her zaman hariç. Kitle her açılışta yeniden hesaplanır →
  geri alma anında yansır. Kampanya onay VERMEZ, personel onayı AŞAMAZ.
- **Önizleme** yalnızca sayılar (uygun / segmentte / izin yok / iletişim eksik); iletişim listesi ya da dışa aktarma yok.
- **Şablon:** yalnızca `{{firstName}}`, `{{restaurantName}}`, `{{couponCode}}`; bilinmeyen alan kaydı engeller; kod / HTML
  yürütülmez. Gelecekteki gönderim sağlayıcıları (e-posta / SMS / WhatsApp) Sprint 16 doğrulama sağlayıcısından AYRI
  olacak; abonelikten çıkma mevcut onay geri alma altyapısını kullanacak (sahte bağlantı üretilmedi).

## 142. Yetki, analitik, gizlilik

- `campaigns.view` / `campaigns.manage` → sahip + şube müdürü. Garson / kasiyer / mutfak / bar → 404 (bölüm layout).
  Destek modu salt okunur.
- **Denetim:** `COUPON_CREATED`, `COUPON_UPDATED`, `COUPON_ARCHIVED`, `LOYALTY_REWARD_CREATED`, `LOYALTY_REWARD_UPDATED`,
  `CAMPAIGN_CREATED`, `CAMPAIGN_UPDATED`; sipariş denetiminde promosyon türü / indirim / puan. İletişim listesi yok.
- **Analitik tanımı:** "Sipariş Tutarı" NET tutardır (indirim sonrası, `total_minor`). Genel bakış altında Promosyonlar:
  brüt (ara toplam), toplam indirim, net, promosyonlu sipariş, kupon / ödül kullanımı, kullanılan puan — iptal / ret
  hariç. ROI ya da kampanya dönüşümü İDDİA EDİLMEZ. İşletme Danışmanı'na bağlanmadı.
- **CRM ayrıntısı:** müşterinin kullandığı kupon / ödüller ve harcanan puan.
- **Sesli AI:** kupon aracı EKLENMEDİ (ertelendi); AI indirim uyduramaz / uygulayamaz.
- **Rezervasyon:** promosyon uygulanmaz.
- **Saklama:** kupon kullanımı, promosyon kopyası ve sadakat defteri iş kaydıdır; otomatik silinmez. Kampanya
  taslakları arşivlenir.

## 143. Testler ve performans (Sprint 18)

- **Birim:** `tests/unit/promotions.test.ts`, `tests/unit/campaign-authorization.test.ts`; destek modu taramasına
  `campaign.actions` eklendi.
- **Entegrasyon (Neon):** `tests/integration/promotions.test.ts` — 22 zorunlu madde + güvenlik.
- **Ölçüm:** `tests/load/promotions.load.test.ts` → `tmp/load/promotions.json`.
- **Tarayıcı:** `tests/e2e/e2e-sprint18.cjs` (regresyon id 18).

## 144. Ödemeler — mimari (Sprint 19)

- **Modeller:** `PaymentSettings` (kiracı başına; varsayılan KAPALI), `Payment` (sipariş başına çok; yöntem ONLINE /
  CASH / CARD_TERMINAL / OTHER; bölme FULL / AMOUNT / EQUAL / ITEMS), `PaymentAttempt` (sağlayıcı denemesi; referans ve
  sağlayıcı idempotency anahtarı tekil), `PaymentAllocation` (ödeme → sipariş / kalem + adet; yalnızca ekleme),
  `PaymentRefund` (değiştirilemez tutar), `PaymentWebhookEvent` (sağlayıcı + olay kimliği tekil; ham gövde YOK).
  Tüm tutarlar tamsayı kuruş, tek para birimi (sipariş para birimi). Bileşik FK'ler kiracı sınırını DB'de korur.
- **Durumlar:** PENDING → PROCESSING → SUCCEEDED → PARTIALLY_REFUNDED → REFUNDED; FAILED / CANCELLED. Kesinleşen ödeme
  geri dönmez (`payments_guard`). Siparişin ödeme durumu (UNPAID / PARTIALLY_PAID / PAID / PARTIALLY_REFUNDED / REFUNDED)
  `OrderStatus`'tan AYRIDIR ve türetilir (`paymentSummary`, `src/lib/payments/state.ts`).
- **Ödenebilir:** ACCEPTED / PREPARING / READY / SERVED. SUBMITTED (henüz onaylanmadı), REJECTED, CANCELLED ödenemez.
- **Erişim:** müşteri ödemesi sipariş sayfasıyla AYNI kural — aynı masanın geçerli QR bağlamı + son 24 saat; sipariş iç
  kimliği, kiracı, tutar istemciden alınmaz.

## 145. Sağlayıcı soyutlaması

- `PaymentProvider` (`src/server/payments/providers/types.ts`): createPayment / getPayment / cancelPayment /
  refundPayment / verifyWebhook / parseWebhook. Yalnızca `mock` uygulandı (barındırılan sayfa `/odeme/mock/<ref>`
  kiracı alan adında; SUCCESS / FAIL / PENDING / TIMEOUT kuyruğu, iade reddi). Sağlayıcı seçilmedi, sabit kodlanmadı.
- Webhook imzası (test sağlayıcısı): `t=<ms>,v1=HMAC-SHA256(secret, "<t>.<ham gövde>")`, 5 dk tolerans, sabit zamanlı
  karşılaştırma. Gerçek sağlayıcı kendi şemasını `verifyWebhook` içinde uygular.
- **GERÇEK ÖDEME SAĞLAYICISI DOĞRULANMADI.**

## 146. Tutar, bölme, dağılım

- Kalan = toplam − kesinleşmiş ödemeler (iade edilenler dahil — iade bakiyeyi açmaz). Kullanılabilir = kalan − etkin
  rezervasyonlar.
- Eşit bölme: `splitEqually` (kalan kuruşlar ilk paylara). Müşteri payını öder; sunucu ≤ kullanılabilir olduğunu doğrular.
- Kalem payı: `linePayables` — sabit / yüzde / ödül indirimi indirim ÖNCESİ kalem tutarlarıyla orantılı (en büyük kalan,
  deterministik); ücretsiz ürün indirimi eşleşen kalemin ilk birimine (0 ₺). Σ kalem = toplam. Birimler sırayla ödenir;
  tutar ile yapılan ödemeler kaleme yazılmaz.

## 147. Eşzamanlılık, rezervasyon, idempotency

- Ödeme oluşturma ve kesinleştirme sipariş satırını `FOR UPDATE` kilitler. Uçuştaki ödeme `reserved_until`
  (varsayılan 15 dk, 1–120 ayarlanabilir) boyunca payını tutar; süresi dolan CANCELLED + deneme EXPIRED (sonraki istekte).
- `payments_guard`: SUCCEEDED'a geçişte kesinleşmiş toplam > sipariş toplamı ya da kalem adedi aşımı → hata (son savunma).
- Geç onay (rezervasyon düşmüş): bakiye uygunsa kabul; değilse CANCELLED + `needs_refund` ("İade gerekli").
- İstemci anahtarı (tarayıcı CSPRNG; seçim değişince yenilenir) → `sha256` + istek özeti; aynı anahtar + farklı istek →
  `idempotency_conflict`. Sağlayıcıya `<paymentId>:1` anahtarı gider. Personel formlarında anahtar sunucuda üretilir.

## 148. Webhook, mutabakat, hatalar

- `POST /api/v1/payments/webhook/<sağlayıcı>`: imza → ayrıştır → olay kimliği tekil kayıt → işle. Yinelenen olay 200
  "duplicate"; sırasız "failed" kesinleşmiş ödemeyi bozmaz; bilinmeyen referans 200 "unknown_reference"; 64 KB sınırı.
- Kayıp webhook: müşteri dönüş sayfası yoklaması ve panel mutabakatı `refreshFromProvider` ile sağlayıcıya sorar.
- Sağlayıcı kesintisi: deneme FAILED, rezervasyon serbest, müşteriye "Online ödeme şu anda kullanılamıyor"; sipariş verme
  ve "Hesap İste" etkilenmez.

## 149. Manuel ödeme, iade, yetkiler, analitik

- Kasada ödeme (CASH / CARD_TERMINAL / OTHER): sağlayıcısız SUCCEEDED, aynı bakiye kuralı, denetim `PAYMENT_MANUAL_RECORDED`.
- İade: kesinleşmiş ve iade edilmemiş tutar − bekleyen iadeler kadar; ödeme satırı kilitli; PENDING kayıt + denetim
  `PAYMENT_REFUND_REQUESTED` → sağlayıcı (online) → SUCCEEDED / FAILED + `PAYMENT_REFUNDED`. Sadakat / kupon DEĞİŞMEZ.
- Yetkiler: `payments.view / manage / refund` → sahip, müdür, kasiyer. Ayarlar ve mutabakat yalnızca sahip / müdür.
  Garson siparişte yalnızca durum rozeti görür; mutfak / bar / KDS ödeme görmez. Destek modu salt okunur.
- Analitik (Genel bakış): ödenmiş / kısmi / ödenmemiş sipariş, online ve kasada tutar, iade, başarısız deneme — muhasebe
  ya da "kesinleşmiş ciro" değildir. AI asistanında ödeme aracı YOK. Rezervasyon depozitosu / SaaS faturalama yok.
- Günlük: imza, kart, cvv, ödeme bağlantısı, webhook sırrı alanları redakte edilir; ham webhook gövdesi saklanmaz.

## 150. Testler ve performans (Sprint 19)

- **Birim:** `tests/unit/payments.test.ts` (bölme, orantılı dağıtım, kalem / ücretsiz ürün, bakiye / rezervasyon, durum
  makinesi, iade sınırı, imza, test sağlayıcısı, AI araç güvenliği, redaksiyon), `tests/unit/payment-authorization.test.ts`;
  destek modu taramasına `payment.actions` eklendi.
- **Entegrasyon (Neon):** `tests/integration/payments.test.ts` — 23 senaryo (yarış, geç onay, tetikleyiciler, izolasyon).
- **Ölçüm:** `tests/load/payments.load.test.ts` → `tmp/load/payments.json` (test sağlayıcısı; ağ gecikmesi hariç).
- **Tarayıcı:** `tests/e2e/e2e-sprint19.cjs` (regresyon id 19, `PAYMENT_PROVIDER=mock`).

## 151. Abonelik — mimari (Sprint 20)

- **Tek kaynak:** `src/config/plans.ts` — 16 özellik kimliği (`FEATURES`), paket → özellik, paket → limit (GEÇİCİ),
  `minimumPlanFor`. Pazarlama kartları, panel gezintisi, abonelik sayfası ve Super Admin aynı tabloyu okur.
- **Modeller:** `Subscription` (kiracı başına tek güncel satır — benzersiz; plan, durum, dönem, deneme / ek süre sonu,
  dönem sonunda iptal, `internal`, `provider = "manual"`), `SubscriptionEvent` (yalnızca ekleme; eski / yeni paket ve
  durum, aktör, güvenli metadata), `EntitlementOverride` (kiracıya özel özellik aç / kapa ya da limit, süreli, gerekçeli).
- **Tenant.plan aynadır:** `subscriptions_plan_mirror` tetikleyicisi eşitler; `tenants_plan_guard` farklı doğrudan yazımı
  reddeder. İşletmenin operasyonel durumu (`Tenant.status`) faturalama durumundan AYRIDIR.
- **Politika:** `src/config/billing.ts` — deneme 14 gün (önerilen AI), deneme bitince ek süre YOK → STARTER;
  dönem bitince 7 gün ek süre (operasyon sürer, `voice_ai` / `business_advisor` kapalı) → STARTER; askı → STARTER.

## 152. Faturalama durum motoru ve yetki çözücü

- `src/lib/billing/engine.ts` (SAF): (durum, dönem sonu, deneme sonu, ek süre sonu, iptal, now) → etkin durum
  (TRIALING / ACTIVE / GRACE / TRIAL_EXPIRED / EXPIRED / SUSPENDED / NONE), etkin paket, özellik kümesi, limitler, uyarı,
  kararlı hata kodu (`feature_disabled` / `limit_reached` / `subscription_expired` / `trial_expired`). Cron'a bağlı değil.
- `src/server/billing/entitlements.ts`: `resolveEntitlements` (taze), `getTenantEntitlements` (istek kapsamlı React
  cache — süreç / Redis önbelleği YOK, değişiklik her süreçte bir sonraki istekte geçerli), `checkFeature`,
  `requireFeature`, `assertWithinLimit`, `getUsage`, `usageAllows`. Tarayıcı paket / özellik / limit gönderemez.

## 153. Uygulama (feature enforcement) ve devam politikası

- Kapı mutasyon / servis katmanında: sipariş gönderimi (işlem içinde, taze), servis talebi, rezervasyon (müsaitlik +
  oluşturma), ödeme oluşturma (online + kasa), sadakat kazanımı, promosyon (sipariş + önizleme), CRM katılımı, kampanya /
  kupon / ödül, istasyon ayarları, analitik dışa aktarma, AI (sesli + Danışman).
- **Devam (bilinçli olarak kapısız):** sipariş durum geçişleri ve KDS fişleri, açık servis taleplerini tamamlama,
  mevcut rezervasyonu yönetme / iptal (personel + misafir bağlantısı), İADE ve mutabakat, onay geri alma ve müşteri
  gizlilik eylemleri (KVKK), sadakat geri alma. Paket düşse de hiçbir kayıt silinmez.
- **Panel:** `NavItem.feature` + `lockMode` ("screen" → yükseltme ekranı; "continue" → içerik + bant). Gezinme durumu
  merkezi `navState` (gizli / kilitli + paket rozeti / görünür).
- **Müşteri:** menü her pakette; sipariş / servis düğmesi, rezervasyon, ödeme, AI, hesap yalnızca paket içeriyorsa.
  Faturalama uyarısı müşteriye GÖSTERİLMEZ.
- **Denetim:** `tests/unit/feature-audit.test.ts` her sunucu eylemini ve rotayı sınıflandırır; sınıflandırılmamış yeni uç
  nokta testi kırar, kapılı olanların kaynağında kanonik kapı aranır, kanonik çözücü dışında paket karşılaştırması yasak.

## 154. Limitler ve kullanım

- Limitler: şube, masa, (arşivlenmemiş) ürün, personel, görsel depolama, aylık sesli AI dakikası, aylık AI yanıtı, aylık
  Danışman yenilemesi. `null` = sınırsız. Değerler GEÇİCİ (ticari karar değil).
- Eşzamanlılık: `assertWithinLimit` (kiracı + limit) başına `pg_advisory_xact_lock` → sayım → kayıt AYNI işlemde; son
  slota gelen iki istekten biri geçer. Limit düşerse mevcut kayıtlar SİLİNMEZ; yalnızca yenisi engellenir.
- Kullanım ayrı sayaçta tutulmaz, mevcut tablolardan türetilir; dönem = abonelik dönemi, yoksa UTC takvim ayı.
  AI limiti dolunca sağlayıcı ÇAĞRILMAZ (sürpriz harcama yok). Uyarılar %80 / %90, engel %100.

## 155. Super Admin ve kiracı sayfaları

- `/admin/abonelikler`: liste + platform sayıları (paket / deneme / aktif / ek süre / süresi dolan) — gelir / MRR / ARR yok.
- İşletme › "Abonelik & Plan": etkinleştir / yenile (paket + dönem sonu + iç), deneme başlat / uzat, dönem sonu, dönem
  sonunda iptal, durum (ödeme gecikti / askı / süresi doldu / iptal), istisnalar, paket değişikliği, olay geçmişi.
  Her değişiklik `SubscriptionEvent` + denetim (`SUBSCRIPTION_*`, `ENTITLEMENT_OVERRIDE_*`).
- `/panel/abonelik`: yalnızca sahip (`billing.view`); müdür paket rozetini panoda görür. Destek modu salt okunur.
  Yükseltme: "Paket yükseltmek için iletişime geçin" (self-servis ödeme yok). Sahip panelinde deneme / ek süre uyarı bandı.

## 156. Test izolasyonu (tarayıcı)

- `tests/e2e/lib/subscription.cjs`: her paket regresyon koşucusu tarafından AÇIK abonelik profiliyle başlatılır (demo =
  faturasız iç AI, istisna yok) ve koşu sonunda varsayılana döner; paket içinde paket değiştiren testler aynı yardımcıyı kullanır.

## 157. Testler (Sprint 20)

- **Birim:** `tests/unit/billing.test.ts` (motor, harita, limit, gezinme), `tests/unit/feature-audit.test.ts` (denetim
  matrisi); yetki testlerine `feature_disabled` senaryoları; `tests/support/entitlements-mock.ts`.
- **Entegrasyon (Neon):** `tests/integration/billing.test.ts` — 26 zorunlu madde; tüm fikstürler açık abonelikle.
- **Tarayıcı:** `tests/e2e/e2e-sprint20.cjs` (regresyon id 20).
