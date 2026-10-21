import { describe, expect, it, vi } from "vitest";
import { CONSENT_COPY, CONSENT_VERSION } from "@/config/consent";
import { consentTransition, currentConsents, type ConsentRowLike } from "@/lib/crm/consent";
import { cleanName, displayName, maskEmail, maskPhone, normalizeEmail, normalizePhone } from "@/lib/crm/contact";
import { earnsOnTransition, isRepeatCustomer, ledgerSummary, pointsForOrder, REPEAT_CUSTOMER_MIN_SERVED } from "@/lib/crm/loyalty";
import { codeMatches, hashCustomerToken, hashVerificationCode, isSessionActive, isWellFormedToken, newCustomerToken, newVerificationCode, sessionExpiry } from "@/lib/crm/session";
import { hasPermission } from "@/lib/permissions/roles";
import { sanitizeAuditMetadata } from "@/lib/audit/actions";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

/** Sprint 16 — CRM / onay / sadakat saf kuralları. */
describe("iletişim normalizasyonu", () => {
  it.each([
    ["0532 123 45 67", "+905321234567"],
    ["(0532) 123-45-67", "+905321234567"],
    ["5321234567", "+905321234567"],
    ["+90 532 123 45 67", "+905321234567"],
    ["905321234567", "+905321234567"],
    ["0044 7700 900123", "+447700900123"],
    ["+44 7700 900123", "+447700900123"],
  ])("telefon %s → %s", (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it.each(["", "abc", "123", "0212", "+", "05321234567890123", "532-12x"])("geçersiz telefon %s → null", (raw) => expect(normalizePhone(raw)).toBeNull());

  it("e-posta kırpılır ve küçük harfe çevrilir; geçersizler reddedilir", () => {
    expect(normalizeEmail("  Ayse.Yilmaz@Mail.COM ")).toBe("ayse.yilmaz@mail.com");
    for (const bad of ["", "a@", "@b.com", "a b@c.com", "a@b", "a@-b.com", `${"x".repeat(65)}@b.com`]) expect(normalizeEmail(bad)).toBeNull();
  });

  it("ad temizliği: harf / boşluk / kesme / tire; HTML ve rakam reddedilir", () => {
    expect(cleanName("  Ayşe   Nur ")).toBe("Ayşe Nur");
    expect(cleanName("O'Neil-Smith")).toBe("O'Neil-Smith");
    expect(cleanName("<b>x</b>")).toBeNull();
    expect(cleanName("Ali2")).toBeNull();
    expect(cleanName("")).toBeNull();
  });
});

describe("maskeleme", () => {
  it("TR telefon 0539 *** ** 25 biçiminde", () => expect(maskPhone("+905391234525")).toBe("0539 *** ** 25"));
  it("yabancı telefon yalnızca ülke kodu + son 2 hane", () => expect(maskPhone("+447700900123")).toBe("+44 *** 23"));
  it("e-posta a***@alan", () => expect(maskEmail("ayse.yilmaz@mail.com")).toBe("a***@mail.com"));
  it("boş değer null", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
  });
  it("maske tam değeri içermez", () => {
    const masked = `${maskPhone("+905391234525")} ${maskEmail("ayse.yilmaz@mail.com")}`;
    expect(masked).not.toContain("1234");
    expect(masked).not.toContain("yilmaz");
  });
  it("gösterim adı iletişim bilgisine düşmez", () => {
    expect(displayName({ firstName: null, lastName: null, publicId: "abcdef123" })).toBe("Misafir · abcdef");
    expect(displayName({ firstName: "Ayşe", lastName: "Y", publicId: "x" })).toBe("Ayşe Y");
  });
});

describe("onay geçişleri ve sürümleme", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 12, m));
  const row = (type: ConsentRowLike["type"], status: ConsentRowLike["status"], m: number, version = CONSENT_VERSION): ConsentRowLike => ({ type, status, createdAt: at(m), version });

  it("hiç kayıt yoksa İzin yok", () => {
    const c = currentConsents([]);
    expect(c.MARKETING_SMS.state).toBe("NONE");
    expect(c.PRIVACY.state).toBe("NONE");
  });
  it("güncel durum en son kayıttır (sıra bağımsız)", () => {
    const c = currentConsents([row("MARKETING_SMS", "REVOKED", 5), row("MARKETING_SMS", "GRANTED", 1), row("MARKETING_EMAIL", "GRANTED", 2)]);
    expect(c.MARKETING_SMS.state).toBe("REVOKED");
    expect(c.MARKETING_EMAIL.state).toBe("GRANTED");
  });
  it("geri alındıktan sonra yeniden verilebilir; geçmiş kayıtlar kendi sürümünü korur", () => {
    const rows = [row("MARKETING_SMS", "GRANTED", 1, "2026-01-v0"), row("MARKETING_SMS", "REVOKED", 2, "2026-01-v0"), row("MARKETING_SMS", "GRANTED", 3)];
    const c = currentConsents(rows);
    expect(c.MARKETING_SMS).toMatchObject({ state: "GRANTED", version: CONSENT_VERSION });
    expect(rows[0].version).toBe("2026-01-v0");
  });
  it("geçiş tablosu: aynı durum kayıt üretmez; hiç verilmemiş izin geri alınmaz", () => {
    expect(consentTransition("NONE", "GRANTED")).toBe("insert");
    expect(consentTransition("REVOKED", "GRANTED")).toBe("insert");
    expect(consentTransition("GRANTED", "GRANTED")).toBe("noop");
    expect(consentTransition("GRANTED", "REVOKED")).toBe("insert");
    expect(consentTransition("NONE", "REVOKED")).toBe("noop");
    expect(consentTransition("REVOKED", "REVOKED")).toBe("noop");
  });
  it("onay metinleri merkezi ve her tür için TR + EN mevcut", () => {
    for (const lang of ["tr", "en"] as const) for (const type of ["PRIVACY", "LOYALTY", "MARKETING_EMAIL", "MARKETING_SMS", "MARKETING_WHATSAPP"] as const) expect(CONSENT_COPY[lang][type].label.length).toBeGreaterThan(5);
    expect(CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });
});

describe("sadakat hesapları", () => {
  it("puan = tutar / kural, aşağı yuvarlanır; kural yoksa 0", () => {
    expect(pointsForOrder(45_000, 1_000)).toBe(45);
    expect(pointsForOrder(45_999, 1_000)).toBe(45);
    expect(pointsForOrder(999, 1_000)).toBe(0);
    expect(pointsForOrder(45_000, null)).toBe(0);
    expect(pointsForOrder(-5, 100)).toBe(0);
  });
  it("kazanım anı merkezi: varsayılan SERVED; kapalı / kuralsız program kazandırmaz; ret / iptal asla", () => {
    const s = { enabled: true, minorPerPoint: 1000, earnOn: "SERVED" as const };
    expect(earnsOnTransition(s, "SERVED")).toBe(true);
    expect(earnsOnTransition(s, "ACCEPTED")).toBe(false);
    expect(earnsOnTransition(s, "SUBMITTED")).toBe(false);
    expect(earnsOnTransition(s, "REJECTED")).toBe(false);
    expect(earnsOnTransition(s, "CANCELLED")).toBe(false);
    expect(earnsOnTransition({ ...s, earnOn: "ACCEPTED" }, "ACCEPTED")).toBe(true);
    expect(earnsOnTransition({ ...s, enabled: false }, "SERVED")).toBe(false);
    expect(earnsOnTransition({ ...s, minorPerPoint: null }, "SERVED")).toBe(false);
    expect(earnsOnTransition(null, "SERVED")).toBe(false);
  });
  it("bakiye defterden türetilir", () => {
    const d = (m: number) => new Date(Date.UTC(2026, 9, 1, 12, m));
    const s = ledgerSummary([
      { type: "EARN", points: 45, createdAt: d(1) },
      { type: "EARN", points: 30, createdAt: d(5) },
      { type: "ADJUSTMENT", points: -20, createdAt: d(3) },
    ]);
    expect(s).toEqual({ balance: 55, totalEarned: 75, lastActivity: d(5) });
    expect(ledgerSummary([])).toEqual({ balance: 0, totalEarned: 0, lastActivity: null });
  });
  it("tekrar gelen müşteri: en az 2 servis edilmiş sipariş", () => {
    expect(REPEAT_CUSTOMER_MIN_SERVED).toBe(2);
    expect(isRepeatCustomer(1)).toBe(false);
    expect(isRepeatCustomer(2)).toBe(true);
  });
});

describe("kimlik kanıtı ve oturum", () => {
  it("opak belirteç 256 bit base64url; sunucuda yalnızca özeti tutulur", () => {
    const t = newCustomerToken();
    expect(isWellFormedToken(t)).toBe(true);
    expect(hashCustomerToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCustomerToken(t)).not.toContain(t);
    expect(newCustomerToken()).not.toBe(t);
  });
  it("biçimsiz çerez reddedilir (müşteri kimliği / cuid kabul edilmez)", () => {
    for (const bad of [undefined, null, "", "cmaaaaaaaaaaaaaaaaaaaaaaa", "x".repeat(44), "a b".repeat(15)]) expect(isWellFormedToken(bad)).toBe(false);
  });
  it("oturum süresi ve geri alma", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const exp = sessionExpiry(now);
    expect(Math.round((exp.getTime() - now.getTime()) / 86_400_000)).toBe(180);
    expect(isSessionActive({ expiresAt: exp, revokedAt: null }, now)).toBe(true);
    expect(isSessionActive({ expiresAt: exp, revokedAt: now }, now)).toBe(false);
    expect(isSessionActive({ expiresAt: new Date(now.getTime() - 1), revokedAt: null }, now)).toBe(false);
  });
  it("doğrulama kodu: 6 hane, özetli, doğrulama kimliğine bağlı", () => {
    const code = newVerificationCode();
    expect(code).toMatch(/^\d{6}$/);
    const h = hashVerificationCode(code, "s".repeat(32), "ver1");
    expect(h).not.toContain(code);
    expect(codeMatches(code, h, "s".repeat(32), "ver1")).toBe(true);
    expect(codeMatches(code, h, "s".repeat(32), "ver2")).toBe(false);
    expect(codeMatches(code === "000000" ? "111111" : "000000", h, "s".repeat(32), "ver1")).toBe(false);
  });
});

describe("yetkiler", () => {
  it("CRM / sadakat: yalnızca sahip ve şube müdürü", () => {
    for (const p of ["crm.view", "crm.manage", "loyalty.view", "loyalty.manage"] as const) {
      expect(hasPermission("TENANT_OWNER", p)).toBe(true);
      expect(hasPermission("BRANCH_MANAGER", p)).toBe(true);
      for (const r of ["WAITER", "CASHIER", "KITCHEN", "BAR", "SUPER_ADMIN"] as const) expect(hasPermission(r, p)).toBe(false);
    }
  });
});

describe("denetim metadata'sı", () => {
  it("emniyet ağı: belirteç / özet anahtarları düşer", () => {
    expect(sanitizeAuditMetadata({ customerRef: "c1", token: "x", tokenHash: "y", codeHash: "z", points: 5 })).toEqual({ customerRef: "c1", points: 5 });
  });
});
