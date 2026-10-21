import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderContext } from "@/server/services/orders/submit-order.service";

// Test doğrulama sağlayıcısı (mock): hiçbir şey göndermez, sabit kod. Üretimde yok sayılır.
process.env.CONTACT_VERIFICATION_PROVIDER = "mock";
process.env.CONTACT_VERIFICATION_MOCK_CODE = "246810";

const jar = new Map<string, string>();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => void jar.set(k, v), delete: (k: string) => void jar.delete(k) })),
}));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { CUSTOMER_COOKIE } = await import("@/lib/crm/session");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { acceptOrder, rejectOrder, serveOrder, cancelOrder, transitionTicket } = await import("@/server/services/orders/order-status.service");
const { listKdsTickets } = await import("@/server/repositories/kds.repository");
const { getServiceBoard } = await import("@/server/repositories/service-requests.repository");
const { getOrderDetail } = await import("@/server/repositories/orders.repository");
const { submitServiceRequest } = await import("@/server/services/service-requests/customer-request.service");
const { readCustomerIdentity, startCustomerSession, endCustomerSession } = await import("@/server/crm/customer-session");
const { joinCustomer, updateOwnConsents, requestOwnDeletion, getOwnProfile } = await import("@/server/crm/customer.service");
const { listCustomers, getCustomerDetail, crmMetrics, createManualCustomer, updateCustomerByStaff } = await import("@/server/crm/crm-panel.service");
const { updateLoyaltySettings, earnLoyaltyInTx, adjustPoints, publicPointsBalance } = await import("@/server/crm/loyalty.service");
const { startVerification, consumeVerification } = await import("@/server/crm/verification");

/**
 * Sprint 16 — CRM / onay / sadakat, gerçek PostgreSQL (Neon). İki geçici kiracı; sonunda silinir.
 * Müşteri çerezi bellek içi kavanozla taklit edilir (tarayıcı başına ayrı kimlik = kavanozu temizlemek).
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `CRM ${label} ${run}`,
      slug: `crm-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr", defaultCurrency: "TRY" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }] },
      users: { create: { email: `crm-${label}-${run}@masanovai.test`, firstName: "C", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, branches: { select: { id: true } }, users: { select: { id: true } } },
  });
  const tenantId = tenant.id;
  const branchId = tenant.branches[0]!.id;
  const category = await prisma.menuCategory.create({ data: { tenantId, name: "Menü", slug: "menu" } });
  await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const station = await prisma.preparationStation.create({ data: { tenantId, branchId, name: "Mutfak", type: "KITCHEN" } });
  await prisma.branch.update({ where: { id: branchId }, data: { defaultStationId: station.id, defaultStationBranchId: branchId } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId, name: "Masa 4" } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  const ctx: OrderContext = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 4", areaName: null, defaultLocale: "tr" };
  const userId = tenant.users[0]!.id;
  const scope = createTenantScope(tenantId);
  return { tenantId, branchId, scope, ctx, actor: { userId, scope, meta } };
}

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
  // Sadakat: 10 TL = 1 puan, servis edildiğinde
  await updateLoyaltySettings(A.actor, { enabled: true, minorPerPoint: 1000, earnOn: "SERVED" });
});

beforeEach(() => jar.clear());

afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  expect(await prisma.customer.count({ where: { tenantId: { in: ids } } })).toBe(0);
  expect(await prisma.loyaltyLedger.count({ where: { tenantId: { in: ids } } })).toBe(0);
});

const items = () =>
  submitOrderSchema.parse({
    items: [
      { product: "burger", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 30000 },
      { product: "ayran", variant: null, modifiers: [], quantity: 3, note: null, expectedUnitPriceMinor: 5000 },
    ],
    note: null,
    idempotencyKey: randomBytes(18).toString("base64url"),
    locale: "tr",
  });

async function place(f: typeof A, customerId: string | null = null) {
  const res = await submitOrder({ ...f.ctx, customerId }, items());
  if (res.kind !== "created") throw new Error(`order not created: ${res.kind}`);
  return prisma.order.findUniqueOrThrow({ where: { publicId: res.order.publicId }, select: { id: true, customerId: true, totalMinor: true } });
}

/** Mutfak fişleri hazır → sipariş READY (servis için ön koşul). */
async function makeReady(f: typeof A, orderId: string) {
  const tickets = await prisma.orderTicket.findMany({ where: { orderId }, select: { id: true } });
  for (const t of tickets) await transitionTicket(f.actor, t.id, "PREPARING");
  for (const t of tickets) await transitionTicket(f.actor, t.id, "READY");
}

const contact = (phone: string | null, email: string | null = null) => ({ phone, phoneNormalized: phone, email, emailNormalized: email });
let ayse: string;

describe("kimlik ve sipariş ilişkisi", () => {
  it("1. anonim sipariş kimliksiz çalışır", async () => {
    const o = await place(A);
    expect(o.customerId).toBeNull();
    expect(await readCustomerIdentity(A.tenantId)).toBeNull();
  });

  it("2. isteğe bağlı katılım: profil + onaylar + sadakat hesabı, kaynak ve sürüm kayıtlı", async () => {
    const r = await joinCustomer(A.tenantId, { firstName: "Ayşe", lastName: "Yılmaz", contact: contact("+905391234525", "ayse@mail.com"), verified: null, consents: ["PRIVACY", "LOYALTY"], source: "ORDER_CHECKOUT", language: "tr" });
    ayse = r.customerId;
    expect(r.linked).toBe(false);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: ayse } });
    expect(c).toMatchObject({ tenantId: A.tenantId, source: "ORDER_CHECKOUT", phoneVerifiedAt: null, emailVerifiedAt: null });
    const consents = await prisma.customerConsent.findMany({ where: { customerId: ayse } });
    expect(consents.map((x) => x.type).sort()).toEqual(["LOYALTY", "PRIVACY"]);
    expect(consents.every((x) => x.status === "GRANTED" && x.version.length > 0 && x.source === "QR_OPT_IN")).toBe(true);
    // Pazarlama izni varsayılan olarak YOK
    expect(consents.some((x) => x.type.startsWith("MARKETING"))).toBe(false);
    // Denetim kaydında telefon / e-posta yok
    const audit = await prisma.auditLog.findMany({ where: { tenantId: A.tenantId, entityId: ayse } });
    expect(audit.map((a) => a.action).sort()).toEqual(["CONSENT_CHANGED", "CUSTOMER_CREATED"]);
    expect(JSON.stringify(audit)).not.toMatch(/905391234525|ayse@mail/);
  });

  it("10. sadakat hesabı katılımla açılır", async () => {
    expect(await prisma.loyaltyAccount.findFirst({ where: { tenantId: A.tenantId, customerId: ayse } })).toMatchObject({ active: true });
  });

  it("5. oturumla verilen sipariş müşteriyle ilişkilenir; 4. aynı masadaki yeni tarayıcı kimliği devralmaz", async () => {
    await startCustomerSession(A.tenantId, ayse);
    const cookie = jar.get(CUSTOMER_COOKIE);
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const identity = await readCustomerIdentity(A.tenantId);
    expect(identity?.customerId).toBe(ayse);
    const linked = await place(A, identity!.customerId);
    expect(linked.customerId).toBe(ayse);
    // Sunucuda yalnızca özet
    expect(await prisma.customerSession.count({ where: { tokenHash: cookie } })).toBe(0);

    jar.clear(); // aynı masa, başka tarayıcı
    expect(await readCustomerIdentity(A.tenantId)).toBeNull();
    const anon = await place(A);
    expect(anon.customerId).toBeNull();

    jar.set(CUSTOMER_COOKIE, cookie!); // aynı tarayıcı geri döner
    expect((await readCustomerIdentity(A.tenantId))?.customerId).toBe(ayse);
    // Başka kiracıda aynı çerez geçersiz
    expect(await readCustomerIdentity(B.tenantId)).toBeNull();
  });

  it("servis talebi isteğe bağlı ilişkilenir; 15. KDS ve servis panosu iletişim bilgisi içermez", async () => {
    await submitServiceRequest({ ...A.ctx, areaId: null, customerId: ayse }, { type: "WATER", note: null, recentOrderIds: [] });
    const sr = await prisma.tableServiceRequest.findFirstOrThrow({ where: { tenantId: A.tenantId, type: "WATER" } });
    expect(sr.customerId).toBe(ayse);
    const o = await place(A, ayse);
    await acceptOrder(A.actor, o.id);
    const kds = JSON.stringify(await listKdsTickets(A.scope));
    const board = JSON.stringify(await getServiceBoard(A.scope, {}));
    for (const leak of ["905391234525", "ayse@mail.com", "Yılmaz", ayse]) {
      expect(kds).not.toContain(leak);
      expect(board).not.toContain(leak);
    }
    // Sipariş ayrıntısı yalnızca gösterim adı
    const detail = await getOrderDetail(A.scope, o.id);
    expect(detail?.customer).toEqual({ id: ayse, name: "Ayşe Yılmaz" });
    expect(JSON.stringify(detail?.customer)).not.toMatch(/905391234525|ayse@mail/);
    await makeReady(A, o.id);
    await serveOrder(A.actor, o.id);
  });
});

describe("sadakat defteri", () => {
  it("11 + 13. servis edilen sipariş TEK kez kazandırır; yeniden deneme / ikinci geçiş çift puan üretmez", async () => {
    const o = await place(A, ayse);
    expect((await acceptOrder(A.actor, o.id)).ok).toBe(true);
    expect(await prisma.loyaltyLedger.count({ where: { orderId: o.id } })).toBe(0); // kabul ≠ kazanım (SERVED)
    await makeReady(A, o.id);
    expect((await serveOrder(A.actor, o.id)).ok).toBe(true);
    const entries = await prisma.loyaltyLedger.findMany({ where: { orderId: o.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "EARN", points: Math.floor(o.totalMinor / 1000) });
    // Yeniden servis girişimi reddedilir; doğrudan yeniden kazanım çağrısı 0 döner; eşzamanlı çağrılar tek satır
    expect((await serveOrder(A.actor, o.id)).ok).toBe(false);
    const again = await Promise.all([1, 2, 3].map(() => prisma.$transaction((tx) => earnLoyaltyInTx(tx, { tenantId: A.tenantId, orderId: o.id, to: "SERVED" }))));
    expect(again).toEqual([0, 0, 0]);
    // Veritabanı benzersizliği: elle ikinci EARN satırı reddedilir
    const account = await prisma.loyaltyAccount.findFirstOrThrow({ where: { tenantId: A.tenantId, customerId: ayse } });
    await expect(prisma.loyaltyLedger.create({ data: { tenantId: A.tenantId, accountId: account.id, type: "EARN", points: 5, orderId: o.id } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(await prisma.loyaltyLedger.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("12. reddedilen / iptal edilen sipariş puan kazanmaz", async () => {
    const r = await place(A, ayse);
    expect((await rejectOrder(A.actor, r.id, "Kapandı")).ok).toBe(true);
    const c = await place(A, ayse);
    await acceptOrder(A.actor, c.id);
    expect((await cancelOrder(A.actor, c.id, "Vazgeçti")).ok).toBe(true);
    expect(await prisma.loyaltyLedger.count({ where: { orderId: { in: [r.id, c.id] } } })).toBe(0);
  });

  it("anonim sipariş servis edilse de puan yazılmaz; bakiye defterden türetilir", async () => {
    const o = await place(A);
    await acceptOrder(A.actor, o.id);
    await makeReady(A, o.id);
    await serveOrder(A.actor, o.id);
    expect(await prisma.loyaltyLedger.count({ where: { orderId: o.id } })).toBe(0);
    const sum = await prisma.loyaltyLedger.aggregate({ where: { tenantId: A.tenantId }, _sum: { points: true } });
    expect(await publicPointsBalance(A.tenantId, ayse)).toBe(sum._sum.points);
  });

  it("veritabanı kısıtları: farklı müşterinin siparişi deftere yazılamaz; EARN siparişsiz / sıfır puan olamaz", async () => {
    const other = await joinCustomer(A.tenantId, { firstName: "Ali", lastName: null, contact: contact("+905551112233"), verified: null, consents: ["PRIVACY", "LOYALTY"], source: "QR_OPT_IN", language: "tr" });
    const otherAccount = await prisma.loyaltyAccount.findFirstOrThrow({ where: { customerId: other.customerId } });
    const aysesOrder = await prisma.order.findFirstOrThrow({ where: { tenantId: A.tenantId, customerId: ayse, status: "REJECTED" } });
    await expect(prisma.loyaltyLedger.create({ data: { tenantId: A.tenantId, accountId: otherAccount.id, type: "REDEEM", points: -1, orderId: aysesOrder.id } })).rejects.toThrow();
    await expect(prisma.loyaltyLedger.create({ data: { tenantId: A.tenantId, accountId: otherAccount.id, type: "EARN", points: 5 } })).rejects.toThrow();
    await expect(prisma.loyaltyLedger.create({ data: { tenantId: A.tenantId, accountId: otherAccount.id, type: "ADJUSTMENT", points: 0 } })).rejects.toThrow();
  });

  it("manuel düzeltme: bakiye eksiye düşemez; denetlenir", async () => {
    const before = (await publicPointsBalance(A.tenantId, ayse)) ?? 0;
    expect(await adjustPoints(A.actor, ayse, -(before + 1), "fazla")).toEqual({ ok: false, reason: "negative_balance" });
    expect(await adjustPoints(A.actor, ayse, 7, "telafi")).toEqual({ ok: true, balance: before + 7 });
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "LOYALTY_ADJUSTMENT" } })).toBe(1);
  });
});

describe("onaylar", () => {
  it("7. izin verme (iletişimi olan kanal); iletişimi olmayan kanal reddedilir", async () => {
    await updateOwnConsents(A.tenantId, ayse, { MARKETING_SMS: true, MARKETING_EMAIL: true });
    const p = await getOwnProfile(A.tenantId, ayse);
    expect(p?.consents.MARKETING_SMS.state).toBe("GRANTED");
    expect(p?.consents.MARKETING_EMAIL.state).toBe("GRANTED");
    const noEmail = await joinCustomer(A.tenantId, { firstName: null, lastName: null, contact: contact("+905550000001"), verified: null, consents: ["PRIVACY"], source: "QR_OPT_IN", language: "tr" });
    await updateOwnConsents(A.tenantId, noEmail.customerId, { MARKETING_EMAIL: true });
    expect((await getOwnProfile(A.tenantId, noEmail.customerId))?.consents.MARKETING_EMAIL.state).toBe("NONE");
  });

  it("8. geri alma anında geçerli; 9. geçmiş korunur (ekleme-yalnız, sürümlü)", async () => {
    await updateOwnConsents(A.tenantId, ayse, { MARKETING_SMS: false });
    expect((await getOwnProfile(A.tenantId, ayse))?.consents.MARKETING_SMS.state).toBe("REVOKED");
    const history = await prisma.customerConsent.findMany({ where: { customerId: ayse, type: "MARKETING_SMS" }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.status)).toEqual(["GRANTED", "REVOKED"]);
    expect(history[1]).toMatchObject({ source: "CUSTOMER_PROFILE", grantedAt: null });
    expect(history[1]!.revokedAt).toBeInstanceOf(Date);
    // Aynı durumu tekrar yazmak kayıt üretmez
    await updateOwnConsents(A.tenantId, ayse, { MARKETING_SMS: false });
    expect(await prisma.customerConsent.count({ where: { customerId: ayse, type: "MARKETING_SMS" } })).toBe(2);
    // Veritabanı kısıtı: REVOKED satırı revoked_at'siz olamaz
    await expect(prisma.customerConsent.create({ data: { tenantId: A.tenantId, customerId: ayse, type: "MARKETING_SMS", status: "REVOKED", source: "CUSTOMER_PROFILE", version: "x" } })).rejects.toThrow();
  });

  it("sadakat onayının geri alınması üyeliği pasifleştirir; sonraki servis puan kazandırmaz", async () => {
    const c = await joinCustomer(A.tenantId, { firstName: "Can", lastName: null, contact: contact("+905550000002"), verified: null, consents: ["PRIVACY", "LOYALTY"], source: "LOYALTY_JOIN", language: "tr" });
    await updateOwnConsents(A.tenantId, c.customerId, { LOYALTY: false });
    expect(await prisma.loyaltyAccount.findFirst({ where: { customerId: c.customerId } })).toMatchObject({ active: false });
    const o = await place(A, c.customerId);
    await acceptOrder(A.actor, o.id);
    await makeReady(A, o.id);
    await serveOrder(A.actor, o.id);
    expect(await prisma.loyaltyLedger.count({ where: { orderId: o.id } })).toBe(0);
  });
});

describe("CRM paneli", () => {
  it("6. müşteri geçmişi: siparişler, servis toplamı, defter", async () => {
    const d = await getCustomerDetail(A.scope, ayse, { reveal: true });
    expect(d).not.toBeNull();
    expect(d!.orders.length).toBeGreaterThanOrEqual(5);
    expect(d!.servedCount).toBeGreaterThanOrEqual(2);
    expect(d!.loyalty?.entries.some((e) => e.type === "EARN")).toBe(true);
    expect(d!.phone).toBe("+905391234525");
    const metrics = await crmMetrics(A.scope);
    expect(metrics.repeat).toBeGreaterThanOrEqual(1);
    expect(metrics.identifiedOrders30d).toBeLessThanOrEqual(metrics.orders30d);
  });

  it("14. destek modu / liste görünümü maskeli", async () => {
    const d = await getCustomerDetail(A.scope, ayse, { reveal: false });
    expect(d!.phone).toBe("0539 *** ** 25");
    expect(d!.email).toBe("a***@mail.com");
    const list = await listCustomers(A.scope, { q: "", page: 1 });
    expect(JSON.stringify(list)).not.toMatch(/905391234525|ayse@mail\.com/);
  });

  it("16. arama: ad / telefon / e-posta (kiracı içinde)", async () => {
    for (const q of ["Ayşe", "yılmaz", "0539 123", "5391234525", "ayse@mail"]) {
      const r = await listCustomers(A.scope, { q, page: 1 });
      expect(r.items.map((i) => i.id), q).toContain(ayse);
    }
    expect((await listCustomers(B.scope, { q: "Ayşe", page: 1 })).total).toBe(0);
  });

  it("3. kiracı izolasyonu: B, A'nın müşterisini göremez / değiştiremez / siparişine bağlayamaz", async () => {
    expect(await getCustomerDetail(B.scope, ayse, { reveal: true })).toBeNull();
    expect(await updateCustomerByStaff(B.actor, ayse, { firstName: "X", lastName: null, contact: contact(null), staffNote: null })).toBe(false);
    expect(await adjustPoints(B.actor, ayse, 100, "x")).toEqual({ ok: false, reason: "no_account" });
    // Bileşik yabancı anahtar: B'nin siparişi A'nın müşterisini taşıyamaz
    await expect(place(B, ayse)).rejects.toThrow();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ayse } })).firstName).toBe("Ayşe");
  });

  it("personel elle ekler: kaynak MANUAL_STAFF, hiçbir onay yok", async () => {
    const id = await createManualCustomer(A.actor, { firstName: "Elle", lastName: null, contact: contact("+905550000003"), staffNote: "Rezervasyon" });
    expect(await prisma.customerConsent.count({ where: { customerId: id } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).source).toBe("MANUAL_STAFF");
  });
});

describe("doğrulama ve bağlama", () => {
  it("mock doğrulama: yanlış kod deneme sayar, doğru kod tek kullanımlık; kod düz metin saklanmaz", async () => {
    const pending = { firstName: "Deniz", lastName: null, phone: "+905557778899", email: null, consents: ["PRIVACY"], source: "QR_OPT_IN" as const, language: "tr" };
    const s = await startVerification(A.tenantId, "PHONE", "+905557778899", pending);
    expect(s.ok).toBe(true);
    const publicId = s.ok ? s.publicId : "";
    const row = await prisma.contactVerification.findUniqueOrThrow({ where: { publicId } });
    expect(row.codeHash).not.toContain("246810");
    expect(await consumeVerification(A.tenantId, publicId, "111111")).toEqual({ ok: false, reason: "invalid" });
    expect(await consumeVerification(B.tenantId, publicId, "246810")).toEqual({ ok: false, reason: "invalid" }); // başka kiracı
    const ok = await consumeVerification(A.tenantId, publicId, "246810");
    expect(ok).toMatchObject({ ok: true, channel: "PHONE", valueNormalized: "+905557778899" });
    expect((await consumeVerification(A.tenantId, publicId, "246810")).ok).toBe(false); // tek kullanımlık
  });

  it("deneme sınırı: 5 hatalı denemeden sonra doğru kod da kabul edilmez", async () => {
    const s = await startVerification(A.tenantId, "EMAIL", "lock@mail.com", { firstName: null, lastName: null, phone: null, email: "lock@mail.com", consents: ["PRIVACY"], source: "QR_OPT_IN", language: "tr" });
    const publicId = s.ok ? s.publicId : "";
    for (let i = 0; i < 5; i++) await consumeVerification(A.tenantId, publicId, "000000");
    expect(await consumeVerification(A.tenantId, publicId, "246810")).toEqual({ ok: false, reason: "locked" });
  });

  it("17. aynı doğrulanmış iletişim mevcut müşteriye bağlanır (yinelenen yok); doğrulanmamış asla birleşmez", async () => {
    const v = { channel: "PHONE" as const, valueNormalized: "+905557778899" };
    const first = await joinCustomer(A.tenantId, { firstName: "Deniz", lastName: null, contact: contact("+905557778899"), verified: v, consents: ["PRIVACY"], source: "QR_OPT_IN", language: "tr" });
    const second = await joinCustomer(A.tenantId, { firstName: "Başka", lastName: "Ad", contact: contact("+905557778899"), verified: v, consents: ["PRIVACY", "LOYALTY"], source: "QR_OPT_IN", language: "tr" });
    expect(first.linked).toBe(false);
    expect(second).toEqual({ customerId: first.customerId, linked: true });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: first.customerId } });
    expect(c.firstName).toBe("Deniz"); // mevcut ad korunur
    expect(c.lastName).toBe("Ad"); // boş alan doldurulur
    expect(c.phoneVerifiedAt).toBeInstanceOf(Date);
    const unverified = await joinCustomer(A.tenantId, { firstName: "Sahte", lastName: null, contact: contact("+905557778899"), verified: null, consents: ["PRIVACY"], source: "QR_OPT_IN", language: "tr" });
    expect(unverified.customerId).not.toBe(first.customerId);
    expect(await prisma.customerVerifiedContact.count({ where: { tenantId: A.tenantId, valueNormalized: "+905557778899" } })).toBe(1);
  });

  it("18. kiracılar arası aynı telefon serbest (bağımsız müşteriler)", async () => {
    const v = { channel: "PHONE" as const, valueNormalized: "+905557778899" };
    const inB = await joinCustomer(B.tenantId, { firstName: "Deniz", lastName: null, contact: contact("+905557778899"), verified: v, consents: ["PRIVACY"], source: "QR_OPT_IN", language: "tr" });
    const inA = await prisma.customerVerifiedContact.findFirstOrThrow({ where: { tenantId: A.tenantId, valueNormalized: "+905557778899" } });
    expect(inB.linked).toBe(false);
    expect(inB.customerId).not.toBe(inA.customerId);
  });

  it("veri silme talebi: izinler geri alınır, oturumlar kapanır, sipariş geçmişi korunur", async () => {
    await startCustomerSession(A.tenantId, ayse);
    const orders = await prisma.order.count({ where: { customerId: ayse } });
    expect(await requestOwnDeletion(A.tenantId, ayse)).toBe(true);
    expect(await readCustomerIdentity(A.tenantId)).toBeNull(); // bu tarayıcının oturumu da kapandı
    expect(await getOwnProfile(A.tenantId, ayse)).toBeNull(); // profil artık müşteriye açılmaz
    expect(await prisma.customerSession.count({ where: { customerId: ayse, revokedAt: null } })).toBe(0);
    const d = await getCustomerDetail(A.scope, ayse, { reveal: true });
    expect(d!.deletionRequestedAt).toBeInstanceOf(Date);
    expect(Object.values(d!.consents).every((c) => c.state !== "GRANTED")).toBe(true);
    expect(await prisma.order.count({ where: { customerId: ayse } })).toBe(orders);
    await endCustomerSession(A.tenantId);
    expect(jar.has(CUSTOMER_COOKIE)).toBe(false);
  });
});
