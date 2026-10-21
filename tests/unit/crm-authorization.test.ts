import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 16 güvenlik — CRM / sadakat panel eylemleri: garson / kasiyer / mutfak / bar erişemez, destek modu yazamaz;
 * müşteri (QR) eylemleri yalnızca müşteri oturum çereziyle yetkilendirilir (istemciden gelen müşteri / kiracı kimliği
 * yok sayılır); sadakat kazanımı sipariş başına tektir.
 */
let session: CurrentSession | null = null;
const cookieJar = new Map<string, string>();
const createManual = vi.fn();
const updateByStaff = vi.fn();
const revokeByStaff = vi.fn();
const adjust = vi.fn();
const saveSettings = vi.fn();
const join = vi.fn();
const ownName = vi.fn();
const ownConsents = vi.fn();
const sessionFind = vi.fn();
const tableCtx = vi.fn();

vi.mock("@/server/billing/entitlements", () => import("../support/entitlements-mock"));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.0.0.9" })),
  cookies: vi.fn(async () => ({ get: (k: string) => (cookieJar.has(k) ? { value: cookieJar.get(k) } : undefined), set: (k: string, v: string) => cookieJar.set(k, v), delete: (k: string) => cookieJar.delete(k) })),
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/env", () => ({ isProduction: false, getServerEnv: () => ({ QR_TOKEN_SECRET: "s".repeat(32) }) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/tenant/table-qr-context", () => ({ getTableQrContext: (...a: unknown[]) => tableCtx(...a) }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    customerSession: { findUnique: (...a: unknown[]) => sessionFind(...a), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async () => ({})) },
    contactVerification: {},
  },
}));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({ findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })) }));
vi.mock("@/server/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 5, retryAfterSeconds: 0, backend: "memory" })),
  rateLimitAll: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/server/crm/crm-panel.service", () => ({ createManualCustomer: (...a: unknown[]) => createManual(...a), updateCustomerByStaff: (...a: unknown[]) => updateByStaff(...a), revokeConsentByStaff: (...a: unknown[]) => revokeByStaff(...a) }));
vi.mock("@/server/crm/loyalty.service", async (orig) => ({ ...(await orig<object>()), adjustPoints: (...a: unknown[]) => adjust(...a), updateLoyaltySettings: (...a: unknown[]) => saveSettings(...a) }));
vi.mock("@/server/crm/customer.service", async (orig) => ({
  ...(await orig<object>()),
  joinCustomer: (...a: unknown[]) => join(...a),
  updateOwnName: (...a: unknown[]) => ownName(...a),
  updateOwnConsents: (...a: unknown[]) => ownConsents(...a),
}));

const crm = await import("@/server/actions/crm.actions");
const customer = await import("@/server/actions/customer.actions");
const { earnLoyaltyInTx } = await import("@/server/crm/loyalty.service");
const { hashCustomerToken, newCustomerToken, CUSTOMER_COOKIE } = await import("@/lib/crm/session");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "cmbbbbbbbbbbbbbbbbbbbbbbb";
const make = (role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession => {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const ID = "cmcustomercustomercustomer";

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  createManual.mockResolvedValue("cmnew");
  updateByStaff.mockResolvedValue(true);
  revokeByStaff.mockResolvedValue(true);
  adjust.mockResolvedValue({ ok: true, balance: 10 });
  join.mockResolvedValue({ customerId: "cmjoined", linked: false });
  ownName.mockResolvedValue(true);
  ownConsents.mockResolvedValue([]);
  tableCtx.mockResolvedValue({ ok: true, context: { tenant: { id: TENANT_A }, table: { id: "cmtable" } } });
  sessionFind.mockResolvedValue(null);
});

describe("CRM panel eylemleri", () => {
  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s hiçbir CRM / sadakat eylemini çalıştıramaz (404)", async (role) => {
    session = make(role);
    await expect(crm.createCustomerAction(null, form({ firstName: "Ali" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(crm.updateCustomerAction(ID, null, form({ firstName: "Ali" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(crm.revokeConsentAction(ID, "MARKETING_SMS")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(crm.adjustPointsAction(ID, null, form({ points: "5", reason: "test" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(crm.saveLoyaltySettingsAction(null, form({ amountPerPoint: "10" }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(createManual).not.toHaveBeenCalled();
    expect(adjust).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("destek modu CRM'de yazamaz (404)", async () => {
    session = make("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(crm.updateCustomerAction(ID, null, form({ firstName: "Ali" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(crm.adjustPointsAction(ID, null, form({ points: "5", reason: "test" }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(updateByStaff).not.toHaveBeenCalled();
  });

  it("müdür düzenleyebilir; kiracı oturumdan gelir, formdaki kiracı yok sayılır", async () => {
    session = make("BRANCH_MANAGER");
    const r = await crm.updateCustomerAction(ID, null, form({ firstName: "Ali", lastName: "", phone: "0532 123 45 67", email: "", staffNote: "", tenantId: TENANT_B }));
    expect(r).toMatchObject({ ok: true });
    const [actor, id, input] = updateByStaff.mock.calls[0] as [{ scope: { tenantId: string } }, string, { contact: { phoneNormalized: string } }];
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(id).toBe(ID);
    expect(input.contact.phoneNormalized).toBe("+905321234567");
  });

  it("personel formunda izin alanı yok: pazarlama izni personel tarafından VERİLEMEZ", async () => {
    session = make("TENANT_OWNER");
    await crm.createCustomerAction(null, form({ firstName: "Ali", MARKETING_SMS: "on", consents: "MARKETING_SMS" })).catch(() => undefined);
    const input = createManual.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(["firstName", "lastName", "contact", "staffNote"]);
  });

  it("izin geri alma yalnızca pazarlama türleri için", async () => {
    session = make("TENANT_OWNER");
    expect(await crm.revokeConsentAction(ID, "PRIVACY")).toMatchObject({ ok: false });
    expect(await crm.revokeConsentAction(ID, "LOYALTY")).toMatchObject({ ok: false });
    expect(revokeByStaff).not.toHaveBeenCalled();
  });

  it("sadakat açılamaz kural belirlenmeden; düzeltme tam sayı ve gerekçe ister", async () => {
    session = make("TENANT_OWNER");
    expect(await crm.saveLoyaltySettingsAction(null, form({ enabled: "on", amountPerPoint: "" }))).toMatchObject({ ok: false });
    expect(saveSettings).not.toHaveBeenCalled();
    await crm.saveLoyaltySettingsAction(null, form({ enabled: "on", amountPerPoint: "12,5", earnOn: "SERVED" }));
    expect(saveSettings.mock.calls[0][1]).toEqual({ enabled: true, minorPerPoint: 1250, earnOn: "SERVED" });
    expect(await crm.adjustPointsAction(ID, null, form({ points: "1.5", reason: "test" }))).toMatchObject({ ok: false });
    expect(await crm.adjustPointsAction(ID, null, form({ points: "5", reason: "" }))).toMatchObject({ ok: false });
    expect(adjust).not.toHaveBeenCalled();
  });
});

describe("müşteri (QR) eylemleri", () => {
  it("katılım gizlilik onayı ve iletişim ister; geçersiz QR nötr ret", async () => {
    expect(await customer.joinCustomerAction("tok", { phone: "0532 123 45 67", consents: [] })).toMatchObject({ kind: "rejected", reason: "privacy_required" });
    expect(await customer.joinCustomerAction("tok", { consents: ["PRIVACY"] })).toMatchObject({ kind: "rejected", reason: "contact_required" });
    tableCtx.mockResolvedValueOnce({ ok: false });
    expect(await customer.joinCustomerAction("bad", { phone: "05321234567", consents: ["PRIVACY"] })).toMatchObject({ kind: "rejected", reason: "context_invalid" });
    expect(join).not.toHaveBeenCalled();
  });

  it("doğrulama kapalı: doğrulanmamış katılım, kiracı QR'dan; iletişimi olmayan pazarlama izni düşer", async () => {
    const r = await customer.joinCustomerAction("tok", { phone: "0532 123 45 67", consents: ["PRIVACY", "MARKETING_SMS", "MARKETING_EMAIL"], tenantId: TENANT_B, customerId: "cmattacker" });
    expect(r).toEqual({ kind: "joined", linked: false });
    const [tenantId, input] = join.mock.calls[0] as [string, { verified: unknown; consents: string[] }];
    expect(tenantId).toBe(TENANT_A);
    expect(input.verified).toBeNull();
    expect(input.consents).toEqual(["PRIVACY", "MARKETING_SMS"]);
    // Oturum çerezi opak belirteçtir — müşteri kimliği DEĞİL
    const cookie = cookieJar.get(CUSTOMER_COOKIE);
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).not.toContain("cmjoined");
  });

  it("profil eylemleri oturumsuz reddedilir; istemcinin gönderdiği müşteri kimliği kullanılmaz", async () => {
    expect(await customer.updateCustomerNameAction("tok", { firstName: "Ali", customerId: ID })).toEqual({ ok: false, reason: "no_identity" });
    expect(await customer.updateCustomerConsentsAction("tok", { MARKETING_SMS: false })).toEqual({ ok: false, reason: "no_identity" });
    expect(ownName).not.toHaveBeenCalled();
    expect(ownConsents).not.toHaveBeenCalled();
  });

  it("başka kiracının oturumu bu kiracıda geçmez", async () => {
    const token = newCustomerToken();
    cookieJar.set(CUSTOMER_COOKIE, token);
    sessionFind.mockImplementation(async (q: { where: { tokenHash: string } }) =>
      q.where.tokenHash === hashCustomerToken(token) ? { id: "sess", tenantId: TENANT_B, customerId: "cmother", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastUsedAt: new Date() } : null,
    );
    expect(await customer.updateCustomerNameAction("tok", { firstName: "Ali" })).toEqual({ ok: false, reason: "no_identity" });
    expect(ownName).not.toHaveBeenCalled();
  });

  it("geçerli oturum: işlem oturumdaki müşteriye uygulanır; gizlilik onayı bu yoldan geri alınamaz", async () => {
    const token = newCustomerToken();
    cookieJar.set(CUSTOMER_COOKIE, token);
    sessionFind.mockResolvedValue({ id: "sess", tenantId: TENANT_A, customerId: "cmme", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastUsedAt: new Date() });
    expect(await customer.updateCustomerNameAction("tok", { firstName: "Ali", lastName: "Veli" })).toEqual({ ok: true });
    expect(ownName).toHaveBeenCalledWith(TENANT_A, "cmme", "Ali", "Veli");
    expect(await customer.updateCustomerConsentsAction("tok", { PRIVACY: false })).toEqual({ ok: false, reason: "invalid" });
  });

  it("süresi dolmuş / geri alınmış oturum kimlik sayılmaz", async () => {
    cookieJar.set(CUSTOMER_COOKIE, newCustomerToken());
    sessionFind.mockResolvedValue({ id: "sess", tenantId: TENANT_A, customerId: "cmme", expiresAt: new Date(Date.now() - 1), revokedAt: null, lastUsedAt: new Date() });
    expect(await customer.updateCustomerNameAction("tok", { firstName: "Ali" })).toEqual({ ok: false, reason: "no_identity" });
    sessionFind.mockResolvedValue({ id: "sess", tenantId: TENANT_A, customerId: "cmme", expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date(), lastUsedAt: new Date() });
    expect(await customer.updateCustomerNameAction("tok", { firstName: "Ali" })).toEqual({ ok: false, reason: "no_identity" });
  });
});

describe("sadakat kazanımı (merkezi, idempotent)", () => {
  function fakeTx(opts: { enabled?: boolean; customerId?: string | null; account?: boolean; existing?: boolean }) {
    const ledger: unknown[] = [];
    let earned = opts.existing ?? false;
    const tx = {
      loyaltySettings: { findUnique: vi.fn(async () => ({ enabled: opts.enabled ?? true, minorPerPoint: 1000, earnOn: "SERVED" })) },
      order: { findFirst: vi.fn(async () => ({ customerId: opts.customerId === undefined ? "cmc" : opts.customerId, totalMinor: 45_500 })) },
      loyaltyAccount: { findFirst: vi.fn(async () => (opts.account === false ? null : { id: "acc" })) },
      // createMany + skipDuplicates = ON CONFLICT DO NOTHING (veritabanı benzersizliği: tenant + order + EARN)
      loyaltyLedger: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          if (earned) return { count: 0 };
          earned = true;
          ledger.push(...data);
          return { count: 1 };
        }),
      },
    };
    return { tx: tx as unknown as Parameters<typeof earnLoyaltyInTx>[0], ledger, raw: tx };
  }
  const input = (to: string) => ({ tenantId: TENANT_A, orderId: "cmorder", to: to as never });

  it("SERVED tek kez kazandırır; yeniden deneme / tekrar olay çift puan üretmez", async () => {
    const { tx, ledger } = fakeTx({});
    expect(await earnLoyaltyInTx(tx, input("SERVED"))).toBe(45);
    expect(await earnLoyaltyInTx(tx, input("SERVED"))).toBe(0);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "EARN", points: 45, orderId: "cmorder", tenantId: TENANT_A });
  });
  it.each(["SUBMITTED", "REJECTED", "CANCELLED", "PREPARING", "READY"])("%s puan kazandırmaz", async (to) => {
    const { tx, raw } = fakeTx({});
    expect(await earnLoyaltyInTx(tx, input(to))).toBe(0);
    expect(raw.loyaltyLedger.createMany).not.toHaveBeenCalled();
  });
  it("anonim sipariş, üyeliği olmayan müşteri ya da kapalı program kazanmaz", async () => {
    for (const opts of [{ customerId: null }, { account: false }, { enabled: false }]) {
      const { tx, raw } = fakeTx(opts);
      expect(await earnLoyaltyInTx(tx, input("SERVED"))).toBe(0);
      expect(raw.loyaltyLedger.createMany).not.toHaveBeenCalled();
    }
  });
});
