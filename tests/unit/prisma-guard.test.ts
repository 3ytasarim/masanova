import { describe, expect, it } from "vitest";
import { checkPrismaCommand, dbIdentity, isLocalDatabase, RESET_OVERRIDE, sameDatabase } from "../../prisma/guard";

/** Sprint 12 güvenlik düzeltmesi — Prisma shadow / reset kilidi (bkz. prisma/guard.ts). Sahte, erişilemeyen URL'ler. */
const NEON_POOLED = "postgresql://owner:secretpw@ep-rapid-truth-b2atyob8-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"; // secret-scan:allow
const NEON_DIRECT = "postgresql://owner:secretpw@ep-rapid-truth-b2atyob8.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require"; // secret-scan:allow
const NEON_OTHER_BRANCH = "postgresql://owner:secretpw@ep-quiet-shadow-a1b2c3d4.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require"; // secret-scan:allow
const NEON_SAME_EP_OTHER_DB = "postgresql://owner:secretpw@ep-rapid-truth-b2atyob8.c-6.eu-central-1.aws.neon.tech/shadowdb"; // secret-scan:allow
const env = { DATABASE_URL: NEON_POOLED, DIRECT_URL: NEON_DIRECT };
const diff = (shadow: string) => ["migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "prisma/schema.prisma", "--shadow-database-url", shadow, "--script"];

describe("veritabanı kimliği", () => {
  it("Neon pooler ve doğrudan host AYNI uç nokta + veritabanı olarak tanınır (metin farklı)", () => {
    expect(NEON_POOLED).not.toBe(NEON_DIRECT);
    expect(dbIdentity(NEON_POOLED)?.key).toBe("neon:ep-rapid-truth-b2atyob8/neondb");
    expect(sameDatabase(NEON_POOLED, NEON_DIRECT)).toBe(true);
    expect(sameDatabase(NEON_DIRECT, NEON_OTHER_BRANCH)).toBe(false);
    expect(sameDatabase(NEON_DIRECT, NEON_SAME_EP_OTHER_DB)).toBe(false);
  });

  it("options=endpoint parametresi ve yerel host eşdeğerleri", () => {
    expect(dbIdentity("postgresql://u:p@some-proxy.example.com/neondb?options=endpoint%3Dep-rapid-truth-b2atyob8")?.key).toBe("neon:ep-rapid-truth-b2atyob8/neondb");
    expect(sameDatabase("postgresql://u:p@localhost/app", "postgres://other:x@127.0.0.1:5432/app")).toBe(true);
    expect(sameDatabase("postgresql://u:p@localhost:5432/app", "postgresql://u:p@localhost:5433/app")).toBe(false);
    expect(sameDatabase("postgresql://u:p@localhost/app", "postgresql://u:p@localhost/app_shadow")).toBe(false);
    expect(isLocalDatabase("postgresql://u:p@[::1]:5432/app")).toBe(true);
    expect(isLocalDatabase(NEON_DIRECT)).toBe(false);
  });
});

describe("Prisma komut kilidi", () => {
  it("BİREBİR aynı URL shadow olarak engellenir", () => {
    expect(checkPrismaCommand(diff(NEON_DIRECT), env)).toMatchObject({ ok: false, reason: expect.stringMatching(/AYNI/) });
    expect(checkPrismaCommand(diff(NEON_POOLED), env).ok).toBe(false);
  });

  it("pooler ↔ doğrudan aynı veritabanı (metin farklı) shadow olarak engellenir", () => {
    expect(checkPrismaCommand(diff(NEON_DIRECT), { DATABASE_URL: NEON_POOLED }).ok).toBe(false);
    expect(checkPrismaCommand(["migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "x", `--shadow-database-url=${NEON_DIRECT}`], { DATABASE_URL: NEON_POOLED }).ok).toBe(false);
    // ortam değişkeninden gelen shadow da denetlenir
    expect(checkPrismaCommand(["migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "x"], { ...env, SHADOW_DATABASE_URL: NEON_POOLED }).ok).toBe(false);
  });

  it("açıkça ayrı shadow veritabanına izin verilir; shadow gerektiren diff shadow'suz engellenir", () => {
    expect(checkPrismaCommand(diff(NEON_OTHER_BRANCH), env)).toEqual({ ok: true });
    expect(checkPrismaCommand(diff(NEON_SAME_EP_OTHER_DB), env)).toEqual({ ok: true });
    expect(checkPrismaCommand(["migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "x"], env).ok).toBe(false);
  });

  it("veri silebilen komutlar varsayılan olarak engelli; uzak DB'de onayla bile engelli; yerel + onay → izinli", () => {
    for (const args of [["migrate", "reset"], ["migrate", "reset", "--force"], ["migrate", "dev"], ["db", "push", "--force-reset"], ["db", "push", "--accept-data-loss"]]) {
      expect(checkPrismaCommand(args, env).ok).toBe(false);
      expect(checkPrismaCommand(args, { ...env, MASANOVA_ALLOW_DB_RESET: RESET_OVERRIDE }).ok).toBe(false);
      expect(checkPrismaCommand(args, { DATABASE_URL: "postgresql://u:p@localhost:5432/test_db", MASANOVA_ALLOW_DB_RESET: RESET_OVERRIDE })).toEqual({ ok: true });
    }
  });

  it("salt-okur / ekleyici komutlar etkilenmez", () => {
    for (const args of [["generate"], ["migrate", "deploy"], ["migrate", "status"], ["migrate", "diff", "--from-url", NEON_DIRECT, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], ["db", "execute", "--url", NEON_DIRECT, "--file", "x.sql"], ["db", "seed"], ["db", "push"], ["studio"]]) {
      expect(checkPrismaCommand(args, env)).toEqual({ ok: true });
    }
  });
});
