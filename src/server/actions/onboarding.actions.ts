"use server";

import { invalid, type ActionResult } from "@/lib/action-result";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { buildSubdomainHostname, isPlatformSubdomain } from "@/lib/domain/get-tenant-url";
import { ROOT_HOSTNAME } from "@/lib/domain/root-domain";
import { emailSchema, hostnameSchema, tenantSlugSchema } from "@/lib/validation/schemas";
import { onboardingSchema } from "@/lib/validation/tenant";
import { isHostnameTaken } from "@/server/repositories/domain.repository";
import { isTenantSlugTaken } from "@/server/repositories/tenant-admin.repository";
import { isEmailTaken } from "@/server/repositories/user.repository";
import { onboardTenant, type OnboardingResult } from "@/server/services/onboarding.service";

export type AvailabilityResult = { available: boolean; message: string };

/** Sihirbaz: kısa ad uygunluğu (biçim + ayrılmış adlar + benzersizlik) — sunucu tarafında. */
export async function checkSlugAvailabilityAction(slug: string): Promise<AvailabilityResult> {
  await requireSuperAdmin();
  const parsed = tenantSlugSchema.safeParse(slug);
  if (!parsed.success) return { available: false, message: parsed.error.issues[0]?.message ?? "Geçersiz." };
  if (await isTenantSlugTaken(parsed.data)) return { available: false, message: "Bu kısa ad kullanımda." };
  return { available: true, message: "Kullanılabilir." };
}

/** Sihirbaz: alt alan adı ya da özel alan adı uygunluğu. */
export async function checkDomainAvailabilityAction(kind: "subdomain" | "custom", value: string): Promise<AvailabilityResult> {
  await requireSuperAdmin();
  if (kind === "subdomain") {
    const parsed = tenantSlugSchema.safeParse(value);
    if (!parsed.success) return { available: false, message: parsed.error.issues[0]?.message ?? "Geçersiz." };
    const hostname = buildSubdomainHostname(parsed.data);
    return (await isHostnameTaken(hostname)) ? { available: false, message: "Bu alt alan adı kullanımda." } : { available: true, message: "Kullanılabilir." };
  }
  const parsed = hostnameSchema.safeParse(value);
  if (!parsed.success) return { available: false, message: parsed.error.issues[0]?.message ?? "Geçersiz." };
  if (parsed.data === ROOT_HOSTNAME || isPlatformSubdomain(parsed.data)) return { available: false, message: "Platform alan adı özel alan adı olamaz." };
  return (await isHostnameTaken(parsed.data)) ? { available: false, message: "Bu alan adı kullanımda." } : { available: true, message: "Kullanılabilir." };
}

export async function checkOwnerEmailAction(email: string): Promise<AvailabilityResult> {
  await requireSuperAdmin();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { available: false, message: parsed.error.issues[0]?.message ?? "Geçersiz." };
  return (await isEmailTaken(parsed.data)) ? { available: false, message: "Bu e-posta ile kayıtlı bir kullanıcı var." } : { available: true, message: "Kullanılabilir." };
}

/**
 * Sihirbazın son adımı. Girdi `unknown` kabul edilir ve tamamen sunucuda doğrulanır.
 * Dönen geçici parola yalnızca bu yanıtta bulunur (istemci başarı ekranında bir kez gösterir).
 */
export async function createTenantAction(input: unknown): Promise<ActionResult<OnboardingResult>> {
  const { user, platform } = await requireSuperAdmin();
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return onboardTenant({ platform, userId: user.id }, parsed.data);
}
