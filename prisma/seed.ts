/**
 * Geliştirme seed'i — idempotent (tekrar çalıştırılabilir).
 *
 *   npx prisma db seed     (ya da: npm run db:seed)
 *
 * Oluşturur:
 *   - "3Y Demo Restaurant" (demo-restoran) → demo.<kök alan>  [ACTIVE]
 *   - "Askıdaki Demo" (askida-demo)        → askida.<kök alan> [SUSPENDED]  — askı akışını yerelde test etmek için
 *   - Merkez Şube, kiracı ayarları (tr / TRY / Europe/Istanbul)
 *   - Demo menü (prisma/seed-menu.ts): kategoriler, ürünler, varyantlar, ekstralar, alerjenler, çeviriler, Kadıköy şubesi
 *   - Super Admin ve demo işletme sahibi kullanıcıları
 *
 * Parolalar: kaynak kodda parola YOK. SEED_*_PASSWORD verilmezse güçlü rastgele parola üretilir ve yalnızca
 * kullanıcı ilk oluşturulduğunda BİR KEZ konsola yazılır. Mevcut kullanıcının parolası yalnızca ilgili
 * SEED_*_PASSWORD açıkça verilirse güncellenir.
 *
 * ÜRETİMDE ÇALIŞMAZ (APP_ENV=production → reddedilir). Üretim ilk yöneticisi: scripts/bootstrap-admin.ts.
 *
 * Neon notu: seed DIRECT_URL (pooler olmayan) bağlantısıyla çalışır.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient, type TenantPlan, type TenantStatus, type UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { buildSubdomainHostname, getTenantUrl } from "../src/lib/domain/get-tenant-url";
import { ROOT_HOSTNAME } from "../src/lib/domain/root-domain";
import { emailSchema, newPasswordSchema, slugSchema, tenantSlugSchema } from "../src/lib/validation/schemas";
import { seedDemoMenu } from "./seed-menu";
import { seedDemoStations } from "./seed-stations";
import { seedDemoTables } from "./seed-tables";
import { resolveAppEnv } from "../src/lib/runtime-profile";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
  console.error("Seed üretim ortamında çalıştırılmaz (gerekirse SEED_ALLOW_PRODUCTION=true).");
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });


type SeedTenant = { name: string; slug: string; label: string; status: TenantStatus; plan: TenantPlan; internal: boolean; branch?: { name: string; slug: string; city: string; district: string } };

const tenants: SeedTenant[] = [
  {
    name: "3Y Demo Restaurant",
    slug: "demo-restoran",
    label: "demo",
    status: "ACTIVE",
    // Demo / iç kiracı: faturasız, süresiz AI aboneliği (koşulda slug'a göre özel durum YAZILMAZ — veriyle ifade edilir).
    plan: "AI",
    internal: true,
    branch: { name: "Merkez Şube", slug: "merkez", city: "İstanbul", district: "Beyoğlu" },
  },
  { name: "Askıdaki Demo", slug: "askida-demo", label: "askida", status: "SUSPENDED", plan: "STARTER", internal: true },
];

async function upsertTenant(seed: SeedTenant) {
  const slug = slugSchema.parse(seed.slug);
  const hostname = buildSubdomainHostname(tenantSlugSchema.parse(seed.label));

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: { name: seed.name, status: seed.status },
    create: { name: seed.name, slug, status: seed.status },
  });

  // Abonelik (Sprint 20): yoksa oluşturulur; varsa DOKUNULMAZ (Super Admin kararını seed ezmez). Tenant.plan tetikleyiciyle aynalanır.
  const sub = await prisma.subscription.findUnique({ where: { tenantId: tenant.id }, select: { id: true } });
  if (!sub) {
    const created = await prisma.subscription.create({ data: { tenantId: tenant.id, plan: seed.plan, status: "ACTIVE", internal: seed.internal }, select: { id: true } });
    await prisma.subscriptionEvent.create({ data: { tenantId: tenant.id, subscriptionId: created.id, type: "SUBSCRIPTION_CREATED", toPlan: seed.plan, toStatus: "ACTIVE", metadata: { source: "seed" } } });
  }

  const existingDomain = await prisma.tenantDomain.findUnique({ where: { hostname } });
  if (existingDomain && existingDomain.tenantId !== tenant.id) {
    throw new Error(`${hostname} başka bir kiracıya bağlı; seed üzerine yazmaz.`);
  }
  await prisma.tenantDomain.upsert({
    where: { hostname },
    update: { type: "SUBDOMAIN", verified: true, isPrimary: true },
    create: { tenantId: tenant.id, hostname, type: "SUBDOMAIN", verified: true, isPrimary: true },
  });

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, defaultLocale: "tr", defaultCurrency: "TRY", timezone: "Europe/Istanbul", primaryColor: "#18181b", accentColor: "#ea580c" },
  });

  if (seed.branch) {
    await prisma.branch.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: seed.branch.slug } },
      update: { name: seed.branch.name },
      create: {
        tenantId: tenant.id,
        name: seed.branch.name,
        slug: seed.branch.slug,
        city: seed.branch.city,
        district: seed.branch.district,
        country: "TR",
        timezone: "Europe/Istanbul",
        currency: "TRY",
        locale: "tr",
      },
    });
  }

  console.log(`✓ Kiracı  ${seed.name.padEnd(20)} ${seed.status.padEnd(9)} ${getTenantUrl(hostname)}`);
  return tenant;
}

const generatedCredentials: { email: string; password: string }[] = [];

async function upsertUser(input: {
  email: string;
  passwordEnv: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
}) {
  const email = emailSchema.parse(input.email);
  const providedPassword = process.env[input.passwordEnv]?.trim();
  if (providedPassword) newPasswordSchema.parse(providedPassword);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        tenantId: input.tenantId,
        ...(providedPassword ? { passwordHash: await hashPassword(providedPassword) } : {}),
      },
    });
    console.log(`✓ Kullanıcı ${email} (mevcut${providedPassword ? ", parola güncellendi" : ", parola korunuyor"})`);
    return;
  }

  const password = providedPassword || randomBytes(18).toString("base64url");
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      tenantId: input.tenantId,
    },
  });
  if (!providedPassword) generatedCredentials.push({ email, password });
  console.log(`✓ Kullanıcı ${email} (oluşturuldu)`);
}

async function main() {
  // Sprint 21: geliştirme / demo seed'i ÜRETİMDE ASLA çalışmaz (demo kiracı + demo hesaplar). Üretim: npm run bootstrap:admin
  if (resolveAppEnv() === "production") {
    console.error("REDDEDİLDİ: geliştirme seed'i APP_ENV=production'da çalışmaz. İlk yönetici için: npm run bootstrap:admin");
    process.exit(1);
  }
  console.log(`Seed başlıyor (kök alan: ${ROOT_HOSTNAME})\n`);

  const [demo] = await Promise.all(tenants.map(upsertTenant));

  await upsertUser({
    email: process.env.SEED_SUPER_ADMIN_EMAIL || "admin@masanovai.local",
    passwordEnv: "SEED_SUPER_ADMIN_PASSWORD",
    firstName: "Platform",
    lastName: "Yöneticisi",
    role: "SUPER_ADMIN",
    tenantId: null,
  });
  await upsertUser({
    email: process.env.SEED_TENANT_OWNER_EMAIL || "owner@demo-restoran.local",
    passwordEnv: "SEED_TENANT_OWNER_PASSWORD",
    firstName: "Demo",
    lastName: "İşletme Sahibi",
    role: "TENANT_OWNER",
    tenantId: demo!.id,
  });

  const menu = await seedDemoMenu(prisma, demo!.id);
  console.log(`✓ Demo menü: ${menu.products} ürün (kategoriler, varyantlar, ekstralar, alerjenler, çeviriler, Kadıköy şube fiyatları)`);

  const tables = await seedDemoTables(prisma, demo!.id);
  console.log(`✓ Demo masalar: ${tables.tables} masa (İç Salon, Bahçe), ${tables.qr} yeni QR kodu`);

  const stations = await seedDemoStations(prisma, demo!.id);
  console.log(`✓ Demo istasyonlar: ${stations.stations} istasyon (Mutfak varsayılan, Bar), ${stations.routes} yeni ürün yönlendirmesi`);

  await prisma.auditLog.create({ data: { action: "SYSTEM_SEED", entity: "System", metadata: { tenants: tenants.map((t) => t.slug) } } });

  if (generatedCredentials.length > 0) {
    console.log("\n──────── YALNIZCA GELİŞTİRME — bu parolalar bir daha gösterilmez ────────");
    for (const c of generatedCredentials) console.log(`  ${c.email.padEnd(32)} ${c.password}`);
    console.log("──────────────────────────────────────────────────────────────────────────\n");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
