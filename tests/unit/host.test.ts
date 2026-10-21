import { describe, expect, it } from "vitest";
import { normalizeHost } from "@/lib/domain/normalize-domain";
import { classifyHost } from "@/lib/tenant/host";
import { hostnameSchema, tenantSlugSchema } from "@/lib/validation/schemas";

describe("normalizeHost", () => {
  it.each([
    ["Demo.LocalHost:3000", "demo.localhost"],
    ["demo.localhost", "demo.localhost"],
    ["  BeyogluCorbacisi.MasaNovai.COM  ", "beyoglucorbacisi.masanovai.com"],
    ["menu.restoran.com.", "menu.restoran.com"],
    ["xn--bylk-0ra.masanovai.com", "xn--bylk-0ra.masanovai.com"],
    ["demo.masanovai.com, evil.com", "demo.masanovai.com"],
    ["[::1]:3000", "[::1]"],
    ["127.0.0.1:3000", "127.0.0.1"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
  });

  it("sonda nokta ve port birlikteyken de normalize eder", () => {
    expect(normalizeHost("menu.restoran.com.:443")).toBe("menu.restoran.com");
  });

  it.each([null, undefined, "", "   ", "demo..localhost", "-demo.localhost", "demo_x.localhost", "demo.localhost:abc", "a/b.com", "evil.com@demo.localhost", "[::1"])(
    "geçersiz host reddedilir: %s",
    (raw) => {
      expect(normalizeHost(raw)).toBeNull();
    },
  );

  it("253 karakterden uzun host reddedilir", () => {
    expect(normalizeHost(`${"a".repeat(63)}.`.repeat(4) + "com")).toBeNull();
  });
});

describe("classifyHost", () => {
  const root = "masanovai.com";

  it("kök alan ve www platformdur", () => {
    expect(classifyHost("masanovai.com", root)).toEqual({ kind: "platform", hostname: "masanovai.com" });
    expect(classifyHost("WWW.masanovai.com", root).kind).toBe("platform");
    expect(classifyHost("app.masanovai.com", root).kind).toBe("platform");
  });

  it("tek seviyeli alt alan kiracı alt alanıdır", () => {
    expect(classifyHost("beyoglucorbacisi.masanovai.com", root)).toEqual({
      kind: "subdomain",
      hostname: "beyoglucorbacisi.masanovai.com",
      label: "beyoglucorbacisi",
    });
  });

  it("kök alan dışı host özel alan adıdır", () => {
    expect(classifyHost("menu.restoran.com", root)).toEqual({ kind: "custom", hostname: "menu.restoran.com" });
  });

  it("benzer görünen ama kök alanın alt alanı olmayan host özel alan adı sayılır", () => {
    expect(classifyHost("evilmasanovai.com", root).kind).toBe("custom");
    expect(classifyHost("masanovai.com.evil.com", root).kind).toBe("custom");
  });

  it("ayrılmış ve çok seviyeli alt alanlar geçersizdir", () => {
    expect(classifyHost("admin.masanovai.com", root)).toMatchObject({ kind: "invalid", reason: "reserved" });
    expect(classifyHost("api.masanovai.com", root)).toMatchObject({ kind: "invalid", reason: "reserved" });
    expect(classifyHost("a.b.masanovai.com", root)).toMatchObject({ kind: "invalid", reason: "nested_subdomain" });
  });

  it("yerel geliştirme: localhost platform, *.localhost kiracı", () => {
    expect(classifyHost("localhost:3000", "localhost").kind).toBe("platform");
    expect(classifyHost("127.0.0.1:3000", "localhost").kind).toBe("platform");
    expect(classifyHost("demo.localhost:3000", "localhost")).toEqual({ kind: "subdomain", hostname: "demo.localhost", label: "demo" });
  });

  it("bozuk host geçersizdir", () => {
    expect(classifyHost(null, root)).toMatchObject({ kind: "invalid", reason: "malformed" });
  });
});

describe("hostname / alt alan şemaları", () => {
  it("özel alan adını normalize eder, tek etiketli host'u reddeder", () => {
    expect(hostnameSchema.parse(" Menu.Restoran.COM ")).toBe("menu.restoran.com");
    expect(hostnameSchema.safeParse("localhost").success).toBe(false);
  });

  it("ayrılmış alt alan adlarını reddeder", () => {
    expect(tenantSlugSchema.safeParse("admin").success).toBe(false);
    expect(tenantSlugSchema.parse("Ustamdoner")).toBe("ustamdoner");
  });
});

describe("classifyHost — iki seviyeli kök alan (masanova.corvis.tech)", () => {
  const ROOT = "masanova.corvis.tech";

  it("kök alan ve www platformdur; firma alt alanı kiracıdır", () => {
    expect(classifyHost("masanova.corvis.tech", ROOT)).toEqual({ kind: "platform", hostname: "masanova.corvis.tech" });
    expect(classifyHost("WWW.Masanova.Corvis.Tech", ROOT)).toEqual({ kind: "platform", hostname: "www.masanova.corvis.tech" });
    expect(classifyHost("idilwaffle.masanova.corvis.tech", ROOT)).toEqual({ kind: "subdomain", hostname: "idilwaffle.masanova.corvis.tech", label: "idilwaffle" });
    expect(classifyHost("idilwaffle.masanova.corvis.tech:443", ROOT)).toMatchObject({ kind: "subdomain", label: "idilwaffle" });
  });

  it("üst alan (corvis.tech) ve kardeş alanlar platform ya da kiracı alt alanı sayılmaz", () => {
    expect(classifyHost("corvis.tech", ROOT)).toEqual({ kind: "custom", hostname: "corvis.tech" });
    expect(classifyHost("qrmenu.corvis.tech", ROOT)).toEqual({ kind: "custom", hostname: "qrmenu.corvis.tech" });
    expect(classifyHost("evilmasanova.corvis.tech", ROOT)).toEqual({ kind: "custom", hostname: "evilmasanova.corvis.tech" });
  });

  it("çok seviyeli ve ayrılmış alt alanlar geçersizdir", () => {
    expect(classifyHost("a.idilwaffle.masanova.corvis.tech", ROOT)).toMatchObject({ kind: "invalid", reason: "nested_subdomain" });
    expect(classifyHost("admin.masanova.corvis.tech", ROOT)).toMatchObject({ kind: "invalid", reason: "reserved" });
    expect(classifyHost("go.masanova.corvis.tech", ROOT)).toMatchObject({ kind: "invalid", reason: "reserved" });
  });
});
