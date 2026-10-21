import { describe, expect, it, vi } from "vitest";
import { resolveTenantByHost, type TenantDomainLookup, type TenantDomainRecord } from "@/lib/tenant/resolve-tenant";

function record(overrides: Partial<Omit<TenantDomainRecord, "tenant">> & { tenant?: Partial<TenantDomainRecord["tenant"]> } = {}): TenantDomainRecord {
  const { tenant, ...rest } = overrides;
  return {
    hostname: "beyoglucorbacisi.masanovai.com",
    type: "SUBDOMAIN",
    verified: true,
    isPrimary: true,
    ...rest,
    tenant: { id: "tenant_a", name: "Beyoğlu Çorbacısı", slug: "beyoglu-corbacisi", status: "ACTIVE", plan: "STARTER", ...tenant },
  };
}

/** Bellek içi lookup: anahtar = normalize edilmiş hostname. Çağrıları izlemek için spy. */
function lookupFrom(records: TenantDomainRecord[]): TenantDomainLookup & { findByHostname: ReturnType<typeof vi.fn> } {
  const byHost = new Map(records.map((r) => [r.hostname, r]));
  return { findByHostname: vi.fn(async (hostname: string) => byHost.get(hostname) ?? null) };
}

const root = "masanovai.com";

describe("resolveTenantByHost", () => {
  it("1) bilinen host doğru kiracıya çözümlenir", async () => {
    const lookup = lookupFrom([
      record(),
      record({ hostname: "ustamdoner.masanovai.com", tenant: { id: "tenant_b", name: "Ustam Döner", slug: "ustamdoner" } }),
    ]);

    const result = await resolveTenantByHost("UstamDoner.masanovai.com:443", { lookup, rootHostname: root });

    expect(result).toMatchObject({ kind: "tenant", tenant: { id: "tenant_b", slug: "ustamdoner", domain: { hostname: "ustamdoner.masanovai.com" } } });
    expect(lookup.findByHostname).toHaveBeenCalledWith("ustamdoner.masanovai.com");
  });

  it("2) bilinmeyen host kiracıya çözümlenmez", async () => {
    const result = await resolveTenantByHost("yok-boyle-bir-yer.masanovai.com", { lookup: lookupFrom([record()]), rootHostname: root });
    expect(result).toEqual({ kind: "not_found", hostname: "yok-boyle-bir-yer.masanovai.com", reason: "unknown_host" });
  });

  it.each(["SUSPENDED", "CANCELLED"] as const)("3) %s kiracı normal erişim almaz", async (status) => {
    const result = await resolveTenantByHost("beyoglucorbacisi.masanovai.com", {
      lookup: lookupFrom([record({ tenant: { status } })]),
      rootHostname: root,
    });
    expect(result.kind).toBe("unavailable");
    expect(result).not.toHaveProperty("tenant.domain"); // tam bağlam (ve dolayısıyla TenantScope) üretilmez
  });

  it("TRIAL kiracı erişebilir", async () => {
    const result = await resolveTenantByHost("beyoglucorbacisi.masanovai.com", {
      lookup: lookupFrom([record({ tenant: { status: "TRIAL" } })]),
      rootHostname: root,
    });
    expect(result.kind).toBe("tenant");
  });

  it("6) localhost: demo.localhost:3000 kiracıya, localhost:3000 platforma çözümlenir", async () => {
    const lookup = lookupFrom([record({ hostname: "demo.localhost", tenant: { id: "demo", slug: "demo-restoran" } })]);

    await expect(resolveTenantByHost("demo.localhost:3000", { lookup, rootHostname: "localhost" })).resolves.toMatchObject({
      kind: "tenant",
      tenant: { id: "demo" },
    });
    await expect(resolveTenantByHost("localhost:3000", { lookup, rootHostname: "localhost" })).resolves.toEqual({
      kind: "platform",
      hostname: "localhost",
    });
    expect(lookup.findByHostname).toHaveBeenCalledTimes(1); // platform host'u için veritabanına gidilmez
  });

  it("platform, ayrılmış ve bozuk host'larda veritabanına hiç gidilmez", async () => {
    const lookup = lookupFrom([]);
    for (const host of ["masanovai.com", "www.masanovai.com", "admin.masanovai.com", "a.b.masanovai.com", "", "bad_host"]) {
      const result = await resolveTenantByHost(host, { lookup, rootHostname: root });
      expect(result.kind === "platform" || result.kind === "not_found").toBe(true);
    }
    expect(lookup.findByHostname).not.toHaveBeenCalled();
  });

  describe("özel alan adı mimarisi", () => {
    const custom = record({ hostname: "menu.restoran.com", type: "CUSTOM_DOMAIN", verified: true, tenant: { id: "tenant_c" } });

    it("doğrulanmış özel alan adı çözümlenir", async () => {
      const result = await resolveTenantByHost("Menu.Restoran.com", { lookup: lookupFrom([custom]), rootHostname: root });
      expect(result).toMatchObject({ kind: "tenant", tenant: { id: "tenant_c", domain: { type: "CUSTOM_DOMAIN" } } });
    });

    it("doğrulanmamış özel alan adı çözümlenmez", async () => {
      const result = await resolveTenantByHost("menu.restoran.com", {
        lookup: lookupFrom([{ ...custom, verified: false }]),
        rootHostname: root,
      });
      expect(result).toMatchObject({ kind: "not_found", reason: "unverified_domain" });
    });

    it("kök alan altındaki bir host CUSTOM_DOMAIN kaydıyla ele geçirilemez", async () => {
      const result = await resolveTenantByHost("sahte.masanovai.com", {
        lookup: lookupFrom([{ ...custom, hostname: "sahte.masanovai.com" }]),
        rootHostname: root,
      });
      expect(result).toMatchObject({ kind: "not_found", reason: "domain_type_mismatch" });
    });
  });
});
