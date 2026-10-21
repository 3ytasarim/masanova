import "server-only";
import { randomInt } from "node:crypto";
import { Prisma, type TenantPlan } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { buildSubdomainHostname, isPlatformSubdomain } from "@/lib/domain/get-tenant-url";
import { ROOT_HOSTNAME } from "@/lib/domain/root-domain";
import { getRequestMeta, type RequestMeta } from "@/lib/security/request-meta";
import type { PlatformScope } from "@/lib/tenant/scope";
import type { Onboarding } from "@/lib/validation/tenant";
import { isHostnameTaken } from "@/server/repositories/domain.repository";
import { isTenantSlugTaken } from "@/server/repositories/tenant-admin.repository";
import { isEmailTaken } from "@/server/repositories/user.repository";
import { buildAuditRow } from "@/server/services/audit.service";
import { newVerificationToken } from "@/server/services/domain-verification.service";
import { createTrialSubscription } from "@/server/billing/subscription.service";

/**
 * Restoran onboarding'i.
 *
 * 1) Ön kontroller (kısa ad / alan adı / e-posta benzersizliği) — kullanıcıya alan bazlı anlaşılır hata için.
 * 2) TEK veritabanı transaction'ı: Tenant + TenantSettings + birincil Branch + TenantDomain(lar)
 *    (+ özel alan adı için DomainVerification) + TENANT_OWNER User + AuditLog satırları.
 *    Herhangi bir adım başarısız olursa hiçbir şey kalıcı olmaz. Ön kontrol ile yazma arasındaki yarış
 *    koşulunu da veritabanının benzersiz indeksleri yakalar (P2002 → alan hatası).
 *
 * Geçici parola: sunucuda üretilir, YALNIZCA argon2id hash'i saklanır; düz metin yalnızca bu fonksiyonun
 * dönüş değerinde bir kez bulunur (başarı ekranında gösterilir), loglanmaz, denetime yazılmaz.
 */

export type OnboardingResult = {
  tenantId: string;
  tenantName: string;
  slug: string;
  branchName: string;
  subdomain: string;
  customDomain: string | null;
  ownerEmail: string;
  plan: TenantPlan;
  /** Yalnızca "generate" modunda dolu; tek seferlik gösterim. */
  temporaryPassword: string | null;
};

type Actor = { platform: PlatformScope; userId: string };

/** 16 karakterlik, karışıklık yaratan karakterler (0/O, 1/l/I) olmadan okunabilir geçici parola. */
export function generateTemporaryPassword(length = 16): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  // randomInt: kriptografik ve modulo yanlılığı olmadan eşit dağılım.
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

/** Sihirbazın kontrol ettiği (ve onboarding'in yeniden kontrol ettiği) benzersizlik / alan kuralları. */
export async function checkOnboardingConflicts(input: Pick<Onboarding, "business" | "domain" | "owner">): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const subdomain = buildSubdomainHostname(input.domain.subdomain);
  const custom = input.domain.customDomain;

  const [slugTaken, subTaken, customTaken, emailTaken] = await Promise.all([
    isTenantSlugTaken(input.business.slug),
    isHostnameTaken(subdomain),
    custom ? isHostnameTaken(custom) : Promise.resolve(false),
    isEmailTaken(input.owner.email),
  ]);

  if (slugTaken) errors["business.slug"] = "Bu kısa ad başka bir işletmede kullanılıyor.";
  if (subTaken) errors["domain.subdomain"] = "Bu alt alan adı kullanımda.";
  if (custom) {
    if (custom === ROOT_HOSTNAME || isPlatformSubdomain(custom)) {
      errors["domain.customDomain"] = "Platform alan adı özel alan adı olarak eklenemez; alt alan adı alanını kullanın.";
    } else if (customTaken) {
      errors["domain.customDomain"] = "Bu alan adı başka bir kayıtta kullanılıyor.";
    }
  }
  if (emailTaken) errors["owner.email"] = "Bu e-posta ile kayıtlı bir kullanıcı var.";
  return errors;
}

export async function onboardTenant(actor: Actor, input: Onboarding): Promise<ActionResult<OnboardingResult>> {
  const conflicts = await checkOnboardingConflicts(input);
  if (Object.keys(conflicts).length > 0) {
    return { ok: false, error: "Bazı bilgiler kullanımda ya da geçersiz.", fieldErrors: conflicts };
  }

  const temporaryPassword = input.owner.passwordMode === "generate" ? generateTemporaryPassword() : null;
  const plainPassword = input.owner.passwordMode === "manual" ? input.owner.password : temporaryPassword!;
  const passwordHash = await hashPassword(plainPassword);

  try {
    const created = await runOnboardingTransaction(actor, input, passwordHash, await getRequestMeta());
    return { ok: true, data: { ...created, temporaryPassword } };
  } catch (error) {
    const mapped = mapUniqueViolation(error);
    if (mapped) return { ok: false, error: "Bazı bilgiler kullanımda.", fieldErrors: mapped };
    console.error("[onboarding] transaction başarısız", error instanceof Error ? error.message : error);
    return { ok: false, error: "İşletme oluşturulamadı. Hiçbir kayıt oluşturulmadı; lütfen tekrar deneyin." };
  }
}

/**
 * Transaction gövdesi (testler geri alma davranışını doğrudan doğrulayabilsin diye ayrı dışa aktarılır).
 * Sıra bilinçli: kullanıcı en son oluşturulur — sahibi oluşturulamayan kiracı geride kalmamalı.
 */
export async function runOnboardingTransaction(
  actor: Actor,
  input: Onboarding,
  passwordHash: string,
  meta: RequestMeta,
): Promise<Omit<OnboardingResult, "temporaryPassword">> {
  const subdomain = buildSubdomainHostname(input.domain.subdomain);
  const custom = input.domain.customDomain ?? null;

  return prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: input.business.name, slug: input.business.slug, plan: input.plan, status: "TRIAL" },
        select: { id: true, name: true, slug: true, plan: true, status: true },
      });

      // Abonelik (Sprint 20): seçilen paket DENEME olarak başlar; deneme bitince FALLBACK_PLAN (veri silinmez).
      await createTrialSubscription(tx, { userId: actor.userId, meta }, tenant.id, input.plan);

      await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          logoUrl: input.branding.logoUrl ?? null,
          primaryColor: input.branding.primaryColor ?? null,
          secondaryColor: input.branding.secondaryColor ?? null,
          accentColor: input.branding.accentColor ?? null,
          defaultLocale: input.branch.locale,
          defaultCurrency: input.branch.currency,
          timezone: input.branch.timezone,
        },
      });

      const branch = await tx.branch.create({
        data: { ...input.branch, tenantId: tenant.id },
        select: { id: true, name: true },
      });

      // Platform alt alanı her zaman oluşturulur ve başlangıçta birincildir (DNS'i platform yönetir → doğrulanmış).
      const subDomain = await tx.tenantDomain.create({
        data: { tenantId: tenant.id, hostname: subdomain, type: "SUBDOMAIN", verified: true, isPrimary: true },
        select: { id: true },
      });

      // Özel alan adı: doğrulanmamış, birincil değil, bekleyen DNS challenge'ı ile.
      const customDomain = custom
        ? await tx.tenantDomain.create({
            data: {
              tenantId: tenant.id,
              hostname: custom,
              type: "CUSTOM_DOMAIN",
              verified: false,
              isPrimary: false,
              verification: { create: { token: newVerificationToken(), status: "PENDING" } },
            },
            select: { id: true },
          })
        : null;

      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.owner.email,
          firstName: input.owner.firstName,
          lastName: input.owner.lastName,
          role: "TENANT_OWNER",
          passwordHash,
        },
        select: { id: true, email: true },
      });

      const base = { tenantId: tenant.id, userId: actor.userId };
      await tx.auditLog.createMany({
        data: [
          buildAuditRow({ ...base, action: "TENANT_CREATED", entity: "Tenant", entityId: tenant.id, metadata: { name: tenant.name, slug: tenant.slug, plan: tenant.plan, status: tenant.status } }, meta),
          buildAuditRow({ ...base, action: "BRANCH_CREATED", entity: "Branch", entityId: branch.id, metadata: { name: branch.name, slug: input.branch.slug, primary: true } }, meta),
          buildAuditRow({ ...base, action: "DOMAIN_CREATED", entity: "TenantDomain", entityId: subDomain.id, metadata: { hostname: subdomain, type: "SUBDOMAIN" } }, meta),
          ...(customDomain
            ? [
                buildAuditRow({ ...base, action: "DOMAIN_CREATED", entity: "TenantDomain", entityId: customDomain.id, metadata: { hostname: custom, type: "CUSTOM_DOMAIN" } }, meta),
                buildAuditRow({ ...base, action: "DOMAIN_VERIFICATION_REQUESTED", entity: "TenantDomain", entityId: customDomain.id, metadata: { hostname: custom } }, meta),
              ]
            : []),
          buildAuditRow(
            { ...base, action: "USER_CREATED", entity: "User", entityId: owner.id, metadata: { email: owner.email, role: "TENANT_OWNER", passwordMode: input.owner.passwordMode === "generate" ? "temporary" : "manual" } },
            meta,
          ),
        ],
      });

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        slug: tenant.slug,
        branchName: branch.name,
        subdomain,
        customDomain: custom,
        ownerEmail: owner.email,
        plan: tenant.plan,
      };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/** Benzersiz indeks ihlalini (eşzamanlı oluşturma yarışı) alan hatasına çevirir. */
function mapUniqueViolation(error: unknown): Record<string, string> | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = String((error.meta?.target as string[] | string | undefined) ?? "");
  if (target.includes("slug")) return { "business.slug": "Bu kısa ad az önce başka bir işletmeye verildi." };
  if (target.includes("hostname")) return { "domain.subdomain": "Bu alan adı az önce başka bir kayda verildi." };
  if (target.includes("email")) return { "owner.email": "Bu e-posta az önce başka bir kullanıcıya verildi." };
  return { _form: "Kayıt benzersizlik kuralına takıldı." };
}
