import { afterAll, describe, expect, it, vi } from "vitest";

/** Üretim alan adı yapısı: platform https://masanova.corvis.tech, firmalar <kısa-ad>.masanova.corvis.tech. */
vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://masanova.corvis.tech");
vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "masanova.corvis.tech");
const { buildSubdomainHostname, getTenantUrl, formatTenantAddress, isPlatformSubdomain } = await import("@/lib/domain/get-tenant-url");
const { getPlatformUrl } = await import("@/lib/domain/get-platform-url");
const { ROOT_HOSTNAME, ROOT_PORT } = await import("@/lib/domain/root-domain");

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("alan adları — masanova.corvis.tech", () => {
  it("firma adresi ve panel adresi doğru üretilir (port yok, https)", () => {
    expect(ROOT_HOSTNAME).toBe("masanova.corvis.tech");
    expect(ROOT_PORT).toBeNull();
    expect(buildSubdomainHostname("idilwaffle")).toBe("idilwaffle.masanova.corvis.tech");
    expect(getTenantUrl("idilwaffle.masanova.corvis.tech")).toBe("https://idilwaffle.masanova.corvis.tech/");
    expect(getTenantUrl("idilwaffle.masanova.corvis.tech", "/t/abc")).toBe("https://idilwaffle.masanova.corvis.tech/t/abc");
    expect(formatTenantAddress("idilwaffle.masanova.corvis.tech")).toBe("idilwaffle.masanova.corvis.tech");
    expect(getPlatformUrl("/admin/isletmeler/yeni")).toBe("https://masanova.corvis.tech/admin/isletmeler/yeni");
  });

  it("yalnızca kök alanın alt alanları platform alt alanıdır", () => {
    expect(isPlatformSubdomain("idilwaffle.masanova.corvis.tech")).toBe(true);
    expect(isPlatformSubdomain("qrmenu.corvis.tech")).toBe(false);
    expect(isPlatformSubdomain("menu.idilwaffle.com")).toBe(false);
  });
});
