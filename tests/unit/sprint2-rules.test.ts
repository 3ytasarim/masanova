import { describe, expect, it } from "vitest";
import { PLANS, planHasFeature } from "@/config/plans";
import { sanitizeAuditMetadata } from "@/lib/audit/actions";
import { buildSubdomainHostname, formatTenantAddress, getTenantUrl, isPlatformSubdomain } from "@/lib/domain/get-tenant-url";
import { getPlatformUrl } from "@/lib/domain/get-platform-url";
import { canTransition, STATUS_TRANSITIONS } from "@/lib/tenant/status";
import { slugify } from "@/lib/utils/slugify";
import { tenantSlugSchema } from "@/lib/validation/schemas";
import { brandingSchema, branchFieldsSchema, demoRequestSchema, onboardingSchema } from "@/lib/validation/tenant";

describe("durum makinesi", () => {
  it("izinli geçişler", () => {
    expect(canTransition("TRIAL", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransition("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(true);
  });

  it("güvensiz geçişler reddedilir; CANCELLED terminal", () => {
    expect(canTransition("ACTIVE", "TRIAL")).toBe(false);
    expect(canTransition("SUSPENDED", "TRIAL")).toBe(false);
    expect(canTransition("ACTIVE", "ACTIVE")).toBe(false);
    expect(STATUS_TRANSITIONS.CANCELLED).toEqual([]);
    for (const to of ["TRIAL", "ACTIVE", "SUSPENDED"] as const) expect(canTransition("CANCELLED", to)).toBe(false);
  });
});

describe("kısa ad", () => {
  it("işletme adından Türkçe karakterleri dönüştürerek öneri üretir", () => {
    expect(slugify("Beyoğlu Çorbacısı")).toBe("beyoglu-corbacisi");
    expect(slugify("  İSTANBUL  Döner & Kebap!! ")).toBe("istanbul-doner-ve-kebap");
    expect(slugify("Şişçi Ümit'in Yeri")).toBe("sisci-umit-in-yeri");
  });

  it("6) ayrılmış kısa adlar kaydedilemez", () => {
    for (const reserved of ["admin", "api", "www", "panel", "giris", "masanova", "platform"]) {
      expect(tenantSlugSchema.safeParse(reserved).success).toBe(false);
    }
  });

  it("URL/DNS güvenli olmayan kısa adlar reddedilir", () => {
    for (const bad of ["a", "-abc", "abc-", "ab--cd", "ab_cd", "çorba", "ab cd", "x".repeat(64)]) {
      expect(tenantSlugSchema.safeParse(bad).success).toBe(false);
    }
    expect(tenantSlugSchema.parse("Beyoglu-Corbaci")).toBe("beyoglu-corbaci");
  });
});

describe("alan adı / URL yardımcıları (NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000)", () => {
  it("alt alan adı kökten üretilir; port yalnızca platform alt alanında eklenir", () => {
    expect(buildSubdomainHostname("beyoglu")).toBe("beyoglu.localhost");
    expect(isPlatformSubdomain("beyoglu.localhost")).toBe(true);
    expect(isPlatformSubdomain("menu.restoran.com")).toBe(false);
    expect(getTenantUrl("beyoglu.localhost")).toBe("http://beyoglu.localhost:3000/");
    expect(getTenantUrl("menu.restoran.com", "/menu")).toBe("http://menu.restoran.com/menu");
    expect(formatTenantAddress("beyoglu.localhost")).toBe("beyoglu.localhost:3000");
    expect(getPlatformUrl("/panel")).toBe("http://localhost:3000/panel");
  });
});

describe("doğrulama şemaları", () => {
  const valid = {
    business: { name: "Beyoğlu Çorbacısı", slug: "beyoglu-corbaci" },
    branch: { name: "Merkez Şube", slug: "merkez", country: "TR", timezone: "Europe/Istanbul", currency: "try", locale: "tr" },
    domain: { subdomain: "beyoglu-corbaci", customDomain: "" },
    owner: { passwordMode: "generate", firstName: "Ayşe", lastName: "Yılmaz", email: "AYSE@Ornek.com " },
    branding: { logoUrl: "", primaryColor: "#FF5500", secondaryColor: "", accentColor: "" },
    plan: "PRO",
  };

  it("geçerli onboarding girdisini normalize eder", () => {
    const parsed = onboardingSchema.parse(valid);
    expect(parsed.owner.email).toBe("ayse@ornek.com");
    expect(parsed.branch.currency).toBe("TRY");
    expect(parsed.branding.primaryColor).toBe("#ff5500");
    expect(parsed.domain.customDomain).toBeUndefined();
  });

  it("tarayıcıdan gelen güvenilir alanlar (tenantId, role, verified, isPrimary) çıktıya geçmez", () => {
    const parsed = onboardingSchema.parse({
      ...valid,
      tenantId: "evil",
      owner: { ...valid.owner, role: "SUPER_ADMIN", tenantId: "evil" },
      domain: { ...valid.domain, verified: true, isPrimary: true },
    });
    expect(parsed).not.toHaveProperty("tenantId");
    expect(parsed.owner).not.toHaveProperty("role");
    expect(parsed.owner).not.toHaveProperty("tenantId");
    expect(parsed.domain).not.toHaveProperty("verified");
    expect(parsed.domain).not.toHaveProperty("isPrimary");
  });

  it("saat dilimi, para birimi, dil, ülke ve renk doğrulanır", () => {
    const branch = valid.branch;
    expect(branchFieldsSchema.safeParse({ ...branch, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(branchFieldsSchema.safeParse({ ...branch, currency: "XYZW" }).success).toBe(false);
    expect(branchFieldsSchema.safeParse({ ...branch, locale: "xx" }).success).toBe(false);
    expect(branchFieldsSchema.safeParse({ ...branch, country: "ZZ" }).success).toBe(false);
    expect(brandingSchema.safeParse({ primaryColor: "red" }).success).toBe(false);
    expect(brandingSchema.safeParse({ logoUrl: "http://insecure.example/logo.png" }).success).toBe(false);
    expect(brandingSchema.safeParse({ logoUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("özel alan adı geçersiz/IP olamaz; elle parola en az 12 karakter", () => {
    expect(onboardingSchema.safeParse({ ...valid, domain: { subdomain: "x1", customDomain: "10.0.0.1" } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, domain: { subdomain: "x1", customDomain: "not a host" } }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, owner: { ...valid.owner, passwordMode: "manual", password: "kisa" } }).success).toBe(false);
  });

  it("demo talebi: telefon/e-posta zorunlu, masa sayısı sayı", () => {
    expect(demoRequestSchema.safeParse({ name: "A", businessName: "Bb", phone: "+90 555 000 00 00", email: "a@b.co", tableCount: "24" }).data?.tableCount).toBe(24);
    expect(demoRequestSchema.safeParse({ name: "A", businessName: "Bb", phone: "abc", email: "a@b.co" }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ name: "A", businessName: "Bb", phone: "+90 555 000 00 00", email: "a@b.co", tableCount: "-3" }).success).toBe(false);
  });
});

describe("paketler", () => {
  it("özellik kümeleri birikimli: STARTER ⊂ PRO ⊂ AI", () => {
    for (const f of PLANS.STARTER.features) expect(planHasFeature("PRO", f)).toBe(true);
    for (const f of PLANS.PRO.features) expect(planHasFeature("AI", f)).toBe(true);
    expect(planHasFeature("STARTER", "ordering")).toBe(false);
    expect(planHasFeature("PRO", "voice_ai")).toBe(false);
    expect(planHasFeature("AI", "voice_ai")).toBe(true);
  });
});

describe("12) denetim metadata temizliği", () => {
  it("parola, token, oturum ve bağlantı dizesi anahtarları düşürülür", () => {
    const clean = sanitizeAuditMetadata({
      email: "a@b.co",
      password: "gizli",
      temporaryPassword: "gizli",
      passwordHash: "$argon2id$...",
      token: "abc",
      verificationToken: "abc",
      sessionId: "s",
      DATABASE_URL: "postgres://",
      nested: { secret: "x", ok: 1, authorization: "Bearer x" },
    });
    expect(clean).toEqual({ email: "a@b.co", nested: { ok: 1 } });
    expect(JSON.stringify(clean)).not.toContain("gizli");
  });
});
