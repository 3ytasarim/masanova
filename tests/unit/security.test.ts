import { describe, expect, it } from "vitest";
import { hasPermission, isTenantRole } from "@/lib/permissions/roles";
import { createMemoryRateLimiter } from "@/lib/security/rate-limit";
import { loginSchema } from "@/lib/validation/schemas";

describe("rol yetkileri", () => {
  it("SUPER_ADMIN kiracı paneline yetkili değildir, yalnızca platform yönetir", () => {
    expect(hasPermission("SUPER_ADMIN", "platform.manage")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "panel.view")).toBe(false);
    expect(isTenantRole("SUPER_ADMIN")).toBe(false);
  });

  it("kiracı rolleri platform yetkisi alamaz", () => {
    for (const role of ["TENANT_OWNER", "BRANCH_MANAGER", "WAITER", "CASHIER", "KITCHEN", "BAR"] as const) {
      expect(hasPermission(role, "platform.manage")).toBe(false);
      expect(hasPermission(role, "panel.view")).toBe(true);
      expect(isTenantRole(role)).toBe(true);
    }
  });

  it("operasyon rolleri yönetim yetkisi alamaz", () => {
    expect(hasPermission("WAITER", "staff.manage")).toBe(false);
    expect(hasPermission("KITCHEN", "menu.manage")).toBe(false);
    expect(hasPermission("BRANCH_MANAGER", "settings.manage")).toBe(false);
    expect(hasPermission("TENANT_OWNER", "settings.manage")).toBe(true);
  });
});

describe("hız sınırlayıcı", () => {
  it("pencere içinde sınırı aşınca engeller, pencere sonunda sıfırlar", () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect(limiter.hit("k").allowed).toBe(true);
    expect(limiter.hit("k").allowed).toBe(true);
    const blocked = limiter.hit("k");
    expect(blocked).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
    expect(limiter.hit("baska").allowed).toBe(true);
    now = 1000;
    expect(limiter.hit("k").allowed).toBe(true);
  });

  it("reset sayacı temizler", () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.hit("k");
    limiter.reset("k");
    expect(limiter.hit("k").allowed).toBe(true);
  });
});

describe("giriş doğrulaması", () => {
  it("e-postayı normalize eder", () => {
    expect(loginSchema.parse({ email: "  Owner@Demo.COM ", password: "x" }).email).toBe("owner@demo.com");
  });

  it("geçersiz girdiyi reddeder", () => {
    expect(loginSchema.safeParse({ email: "değil", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(300) }).success).toBe(false);
    expect(loginSchema.safeParse({ email: ["a@b.co"], password: "x" }).success).toBe(false);
  });
});
