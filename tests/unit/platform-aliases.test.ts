import { describe, expect, it } from "vitest";
import { classifyHost } from "@/lib/tenant/host";
import { parsePlatformHostAliases } from "@/lib/domain/platform-aliases";

/** Ek platform host'ları (geçici tünel) — yalnızca production dışı; kiracı / QR davranışı değişmez. */
describe("PLATFORM_HOST_ALIASES", () => {
  const tunnel = "ornek-adres.trycloudflare.com";
  it("staging: listedeki host platform olur (pazarlama + /giris + /panel + /admin)", () => {
    const aliases = parsePlatformHostAliases({ APP_ENV: "staging", PLATFORM_HOST_ALIASES: ` ${tunnel.toUpperCase()} , ikinci.ornek.test ` });
    expect([...aliases]).toEqual([tunnel, "ikinci.ornek.test"]);
    expect(classifyHost(tunnel, "localhost", aliases)).toEqual({ kind: "platform", hostname: tunnel });
    expect(classifyHost(`${tunnel}:443`, "localhost", aliases).kind).toBe("platform");
  });
  it("production: değişken YOK SAYILIR (tünel host'u platform olamaz)", () => {
    const aliases = parsePlatformHostAliases({ APP_ENV: "production", PLATFORM_HOST_ALIASES: tunnel });
    expect(aliases.size).toBe(0);
    expect(classifyHost(tunnel, "masanovai.com", aliases).kind).toBe("custom");
    expect(parsePlatformHostAliases({ NODE_ENV: "production", PLATFORM_HOST_ALIASES: tunnel }).size).toBe(0);
  });
  it("listede olmayan host'lar değişmez: kiracı alt alanı, özel alan adı, kök alan", () => {
    const aliases = parsePlatformHostAliases({ APP_ENV: "staging", PLATFORM_HOST_ALIASES: tunnel });
    expect(classifyHost("beyoglu.localhost", "localhost", aliases)).toMatchObject({ kind: "subdomain", label: "beyoglu" });
    expect(classifyHost("baska-adres.trycloudflare.com", "localhost", aliases).kind).toBe("custom");
    expect(classifyHost("localhost", "localhost", aliases).kind).toBe("platform");
    expect(classifyHost(tunnel, "localhost").kind).toBe("custom"); // varsayılan: ek host yok
  });
  it("boş / geçersiz değerler yok sayılır", () => {
    expect(parsePlatformHostAliases({ APP_ENV: "staging", PLATFORM_HOST_ALIASES: " , ,http://" }).size).toBe(0);
    expect(parsePlatformHostAliases({ APP_ENV: "staging" }).size).toBe(0);
  });
});
