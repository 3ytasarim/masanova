import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import type { OrderContext } from "@/server/services/orders/submit-order.service";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/navigation", () => navigationMock);
let session: CurrentSession | null = null;
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
process.env.PAYMENT_PROVIDER = "mock";

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { acceptOrder, transitionTicket } = await import("@/server/services/orders/order-status.service");
const { submitServiceRequest } = await import("@/server/services/service-requests/customer-request.service");
const { claimServiceRequest, completeServiceRequest } = await import("@/server/services/service-requests/staff-request.service");
const { addDays, localParts, zonedLocalToUtc } = await import("@/lib/reservations/time");
const booking = await import("@/server/reservations/booking.service");
const resSettings = await import("@/server/reservations/settings.service");
const { dayAvailability } = await import("@/server/reservations/availability.service");
const { createTable } = await import("@/server/services/tables/table.service");
const svcPay = await import("@/server/payments/payment.service");
const mockPay = await import("@/server/payments/providers/mock");
const { resolveEntitlements, checkFeature, requireFeature, EntitlementDeniedError, usageAllows, getUsage } = await import("@/server/billing/entitlements");
const { featureDenied } = await import("@/server/billing/action-gate");
const subs = await import("@/server/billing/subscription.service");
const { getVoiceAiAccess } = await import("@/server/services/ai/access.service");
const adminActions = await import("@/server/actions/subscription-admin.actions");

/**
 * Sprint 20 — abonelik / yetki / limitler, gerçek PostgreSQL (Neon). İki geçici kiracı; sonunda silinir.
 * Paket değişiklikleri abonelik servisinden (Super Admin yolu) yapılır; yetki her kontrolde taze çözülür.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };
const admin = { userId: null, meta };
const TZ = "Europe/Istanbul";
const DAY = 86_400_000;
const RES_DAY = addDays(localParts(new Date(), TZ).date, 3);
const at = (hhmm: string) => {
  const r = zonedLocalToUtc(RES_DAY, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
  if (r.kind === "missing") throw new Error("missing");
  return r.at;
};

async function makeTenant(label: string) {
  const t = await prisma.tenant.create({
    data: {
      name: `Abonelik ${label} ${run}`,
      slug: `abone-${label}-${run}`,
      status: "ACTIVE",
      subscription: { create: { plan: "PRO", status: "ACTIVE" } },
      settings: { create: { defaultLocale: "tr" } },
      paymentSettings: { create: { enabled: true } },
      branches: { create: [{ name: "Merkez", slug: "merkez", timezone: TZ }] },
      users: { create: { email: `abone-${label}-${run}@masanovai.test`, firstName: "A", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, branches: { select: { id: true } }, users: { select: { id: true } } },
  });
  const tenantId = t.id;
  const branchId = t.branches[0]!.id;
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Ana", slug: "ana" } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  const station = await prisma.preparationStation.create({ data: { tenantId, branchId, name: "Mutfak", type: "KITCHEN" } });
  await prisma.branch.update({ where: { id: branchId }, data: { defaultStationId: station.id, defaultStationBranchId: branchId } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId, name: "Masa 1", capacity: 4 } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  const ctx: OrderContext = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" };
  const scope = createTenantScope(tenantId);
  const userId = t.users[0]!.id;
  const actor = { userId, scope, meta, canOverride: true };
  const allDay = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, intervals: [{ opensMinute: 0, closesMinute: 1440 }] }));
  await resSettings.setOpeningHours(actor, branchId, allDay);
  await resSettings.savePolicy(actor, { enabled: true, publicBookingEnabled: true, autoConfirm: true, defaultDurationMinutes: 120, slotIntervalMinutes: 30, minAdvanceMinutes: 30, maxAdvanceDays: 60, minPartySize: 1, maxPartySize: 8, bufferMinutes: 0, cancellationCutoffMinutes: 60, noShowGraceMinutes: 15 });
  return { tenantId, branchId, tableId: table.id, tokenId: token.id, ctx, scope, actor, userId };
}

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;
beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
});
afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.paymentWebhookEvent.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

const plan = (f: typeof A, p: "STARTER" | "PRO" | "AI") => subs.activate(admin, f.tenantId, { plan: p, periodEnd: null });
const order = (f: typeof A) =>
  submitOrder({ ...f.ctx, customerId: null }, submitOrderSchema.parse({ items: [{ product: "burger", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 30000 }], note: null, idempotencyKey: randomBytes(18).toString("base64url"), locale: "tr", promotion: null }));
const orderId = async (r: Awaited<ReturnType<typeof order>>) => {
  if (r.kind !== "created") throw new Error(JSON.stringify(r));
  return (await prisma.order.findUniqueOrThrow({ where: { publicId: r.order.publicId }, select: { id: true } })).id;
};
const svcCtx = (f: typeof A) => ({ tenantId: f.tenantId, branchId: f.branchId, tableId: f.tableId, areaId: null, tokenId: f.tokenId, branchName: "Merkez", areaName: null, tableName: "Masa 1" });
const bookingInput = (f: typeof A, hhmm: string) => ({ branchId: f.branchId, startsAt: at(hhmm), partySize: 2, guestName: "Test Misafir", guestPhone: "+905321112233", guestEmail: null, preferredAreaId: null, specialRequest: null, source: "PUBLIC_WEB" as const, customerId: null, locale: "tr" });

describe("paket yetkileri", () => {
  it("1–3. STARTER / PRO / AI özellik kümeleri kanonik çözücüden", async () => {
    await plan(A, "STARTER");
    let e = await resolveEntitlements(A.tenantId);
    expect([...e.features].sort()).toEqual(["branding", "qr_labels", "qr_menu", "tables"]);
    await plan(A, "PRO");
    e = await resolveEntitlements(A.tenantId);
    expect(e.has("ordering") && e.has("restaurant_payments") && !e.has("voice_ai") && !e.has("business_advisor")).toBe(true);
    await plan(A, "AI");
    e = await resolveEntitlements(A.tenantId);
    expect(e.has("voice_ai") && e.has("business_advisor")).toBe(true);
    // Tenant.plan aynası tetikleyiciyle eşit; doğrudan farklı değer yazılamaz
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: A.tenantId } })).plan).toBe("AI");
    await expect(prisma.tenant.update({ where: { id: A.tenantId }, data: { plan: "STARTER" } })).rejects.toThrow(/mirrors subscriptions/);
  });
  it("4–5. AI denemesi: tüm AI özellikleri; deneme bitince STARTER (trial_expired), veri silinmez", async () => {
    await subs.startTrial(admin, A.tenantId, { plan: "AI", days: 14 });
    expect((await resolveEntitlements(A.tenantId)).state).toBe("TRIALING");
    expect((await checkFeature(A.tenantId, "voice_ai")).allowed).toBe(true);
    const later = new Date(Date.now() + 15 * DAY);
    const e = await resolveEntitlements(A.tenantId, { now: later });
    expect(e).toMatchObject({ state: "TRIAL_EXPIRED", effectivePlan: "STARTER", denial: "trial_expired" });
    expect(await checkFeature(A.tenantId, "ordering", { now: later })).toMatchObject({ allowed: false, code: "trial_expired" });
    expect(await prisma.product.count({ where: { tenantId: A.tenantId } })).toBe(1);
  });
  it("6–7. ek süre: operasyon sürer, AI kapalı; ek süre bitince STARTER (subscription_expired)", async () => {
    await subs.activate(admin, A.tenantId, { plan: "AI", periodEnd: new Date(Date.now() + 2 * DAY) });
    const inGrace = new Date(Date.now() + 4 * DAY);
    const g = await resolveEntitlements(A.tenantId, { now: inGrace });
    expect(g).toMatchObject({ state: "GRACE", effectivePlan: "AI", warning: "grace" });
    expect(g.has("ordering") && !g.has("voice_ai")).toBe(true);
    const after = new Date(Date.now() + 20 * DAY);
    expect(await checkFeature(A.tenantId, "ordering", { now: after })).toMatchObject({ allowed: false, code: "subscription_expired" });
    // Bakım işi kayıtlı durumu normalleştirir; karar zaten zamandan türetiliyordu
    await subs.setStatus(admin, A.tenantId, "PAST_DUE");
    expect((await resolveEntitlements(A.tenantId)).state).toBe("GRACE");
  });
  it("8. yükseltme ANINDA (yeniden başlatma yok): STARTER'da reddedilen sipariş PRO'ya geçince kabul", async () => {
    await plan(A, "STARTER");
    expect(await order(A)).toEqual({ kind: "rejected", reason: "feature_disabled" });
    await plan(A, "PRO");
    expect((await order(A)).kind).toBe("created");
  });
});

describe("uygulama ve devam politikası", () => {
  let activeOrder = "";
  let reservationId = "";
  let paymentId = "";
  it("9–11. PRO'da sipariş + KDS fişi + rezervasyon + ödeme oluşur; düşürmede VERİ KORUNUR", async () => {
    await plan(A, "PRO");
    activeOrder = await orderId(await order(A));
    expect((await acceptOrder(A.actor, activeOrder)).ok).toBe(true);
    const r = await booking.createReservation(A.tenantId, bookingInput(A, "19:00"), null);
    expect(r.ok).toBe(true);
    if (r.ok) reservationId = r.reservation.id;
    mockPay.mockReset();
    mockPay.mockQueue("SUCCESS");
    const p = await svcPay.startOnlinePayment({ tenantId: A.tenantId, orderId: activeOrder, customerId: null, returnUrl: "/", request: { mode: "AMOUNT", amountMinor: 1000, idempotencyKey: randomBytes(18).toString("base64url") } });
    expect(p.ok).toBe(true);
    if (p.ok) paymentId = (await prisma.payment.findUniqueOrThrow({ where: { publicId: p.publicId } })).id;
    const before = { orders: await prisma.order.count({ where: { tenantId: A.tenantId } }), tickets: await prisma.orderTicket.count({ where: { tenantId: A.tenantId } }), res: await prisma.reservation.count({ where: { tenantId: A.tenantId } }), pay: await prisma.payment.count({ where: { tenantId: A.tenantId } }) };
    await plan(A, "STARTER");
    expect({ orders: await prisma.order.count({ where: { tenantId: A.tenantId } }), tickets: await prisma.orderTicket.count({ where: { tenantId: A.tenantId } }), res: await prisma.reservation.count({ where: { tenantId: A.tenantId } }), pay: await prisma.payment.count({ where: { tenantId: A.tenantId } }) }).toEqual(before);
  });
  it("10. STARTER: yeni sipariş reddedilir (QR menü çalışır — paket özelliği)", async () => {
    expect(await order(A)).toEqual({ kind: "rejected", reason: "feature_disabled" });
    expect((await checkFeature(A.tenantId, "qr_menu")).allowed).toBe(true);
  });
  it("12. KDS: mevcut fiş STARTER'da tamamlanır (devam); istasyon ayarı reddedilir", async () => {
    const ticket = await prisma.orderTicket.findFirstOrThrow({ where: { orderId: activeOrder } });
    expect((await transitionTicket(A.actor, ticket.id, "PREPARING")).ok).toBe(true);
    expect((await transitionTicket(A.actor, ticket.id, "READY")).ok).toBe(true);
    expect(await featureDenied(A.tenantId, "preparation_stations")).toMatchObject({ ok: false, code: "feature_disabled" });
  });
  it("13. servis: STARTER'da yeni talep reddedilir; açık talep personel tarafından tamamlanır", async () => {
    await plan(A, "PRO");
    const created = await submitServiceRequest(svcCtx(A), { type: "WATER", note: null, recentOrderIds: [] });
    expect(created.kind).toBe("created");
    await plan(A, "STARTER");
    expect(await submitServiceRequest(svcCtx(A), { type: "NAPKIN", note: null, recentOrderIds: [] })).toEqual({ kind: "rejected", reason: "feature_disabled" });
    const open = await prisma.tableServiceRequest.findFirstOrThrow({ where: { tenantId: A.tenantId, type: "WATER" } });
    const staff = { userId: A.userId, displayName: "A", scope: A.scope, meta, abilities: { view: true, manage: true, billOnly: false, override: true } };
    expect((await claimServiceRequest(staff, open.id)).ok).toBe(true);
    expect((await completeServiceRequest(staff, open.id)).ok).toBe(true);
  });
  it("14. analitik STARTER'da kapalı (sayfa kilidi + dışa aktarma kapısı aynı karar)", async () => {
    expect(await checkFeature(A.tenantId, "analytics")).toMatchObject({ allowed: false, code: "feature_disabled", requiredPlan: "PRO" });
    await expect(requireFeature(A.scope, "analytics")).rejects.toBeInstanceOf(EntitlementDeniedError);
  });
  it("15. rezervasyon: yeni rezervasyon / müsaitlik kapalı; MEVCUT gelecek rezervasyon kaybolmaz ve iptal edilebilir", async () => {
    expect(await booking.createReservation(A.tenantId, bookingInput(A, "20:30"), null)).toMatchObject({ ok: false, reason: "disabled" });
    expect((await dayAvailability(A.tenantId, { branchId: A.branchId, date: RES_DAY, partySize: 2, channel: "public" })).kind).toBe("disabled");
    expect(await prisma.reservation.findUnique({ where: { id: reservationId } })).not.toBeNull();
    expect((await booking.transitionReservation(A.actor, reservationId, "CANCELLED", { reason: "test" })).ok).toBe(true);
  });
  it("16–17. CRM / promosyon STARTER'da kapalı; kupon istenen sipariş promotion_rejected değil sipariş reddi (sipariş de kapalı)", async () => {
    expect(await featureDenied(A.tenantId, "crm")).toMatchObject({ code: "feature_disabled" });
    expect(await featureDenied(A.tenantId, "promotions")).toMatchObject({ code: "feature_disabled" });
    // PRO + promosyon istisnayla kapatılmış: kuponlu sipariş promosyon kapısına takılır, sipariş OLUŞMAZ
    await plan(A, "PRO");
    await subs.setOverride(admin, A.tenantId, { key: "promotions", enabled: false, limitValue: null, expiresAt: null, reason: "test" });
    const r = await submitOrder({ ...A.ctx, customerId: null }, submitOrderSchema.parse({ items: [{ product: "burger", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 30000 }], note: null, idempotencyKey: randomBytes(18).toString("base64url"), locale: "tr", promotion: { kind: "coupon", code: "YOKKOD" } }));
    expect(r).toEqual({ kind: "promotion_rejected", reason: "feature_disabled" });
    await subs.removeOverride(admin, A.tenantId, "promotions");
  });
  it("18–19. ödeme: STARTER'da yeni ödeme reddedilir; GEÇMİŞ ödemenin iadesi çalışır", async () => {
    await plan(A, "STARTER");
    expect(await svcPay.startOnlinePayment({ tenantId: A.tenantId, orderId: activeOrder, customerId: null, returnUrl: "/", request: { mode: "AMOUNT", amountMinor: 500, idempotencyKey: randomBytes(18).toString("base64url") } })).toEqual({ ok: false, reason: "feature_disabled" });
    expect(await svcPay.recordManualPayment(A.actor, { orderId: activeOrder, method: "OTHER", amountMinor: 500, idempotencyKey: randomBytes(18).toString("base64url") })).toEqual({ ok: false, reason: "feature_disabled" });
    expect(await svcPay.onlinePaymentsAvailable(A.tenantId)).toBe(false);
    const refund = await svcPay.refundPayment(A.actor, { paymentId, amountMinor: 1000, reason: "paket düştü", idempotencyKey: randomBytes(18).toString("base64url") });
    expect(refund).toMatchObject({ ok: true, status: "SUCCEEDED", refundedMinor: 1000 });
  });
  it("20–21. sesli AI ve Danışman yalnızca AI paketinde (kanonik çözücü)", async () => {
    await plan(A, "PRO");
    expect((await getVoiceAiAccess(A.tenantId)).availability).toEqual({ available: false, reason: "plan" });
    expect((await checkFeature(A.tenantId, "business_advisor")).allowed).toBe(false);
    await plan(A, "AI");
    expect((await getVoiceAiAccess(A.tenantId)).availability).not.toEqual({ available: false, reason: "plan" });
    expect((await checkFeature(A.tenantId, "business_advisor")).allowed).toBe(true);
  });
});

describe("limitler", () => {
  it("22. masa limiti eşzamanlılık: limit = mevcut + 1, iki eşzamanlı oluşturma → yalnızca biri", async () => {
    const current = await prisma.diningTable.count({ where: { tenantId: B.tenantId } });
    await subs.setOverride(admin, B.tenantId, { key: "maxTables", enabled: null, limitValue: current + 1, expiresAt: null, reason: "yarış testi" });
    const actor = { userId: B.userId, scope: B.scope, meta };
    const input = (name: string) => ({ name, number: null, code: null, capacity: 2, capacityMin: null, reservable: true, active: true, diningAreaId: null });
    const results = await Promise.all([createTable(actor, B.branchId, input(`Yarış X ${run}`)), createTable(actor, B.branchId, input(`Yarış Y ${run}`))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, code: "limit_reached" });
    expect(await prisma.diningTable.count({ where: { tenantId: B.tenantId } })).toBe(current + 1);
    // Limit düşünce mevcut masalar SİLİNMEZ
    await subs.setOverride(admin, B.tenantId, { key: "maxTables", enabled: null, limitValue: 0, expiresAt: null, reason: "düşürme" });
    expect(await prisma.diningTable.count({ where: { tenantId: B.tenantId } })).toBe(current + 1);
    await subs.removeOverride(admin, B.tenantId, "maxTables");
  });
  it("23. kullanım limiti (AI yanıtı): dolunca sağlayıcı ÇAĞRILMADAN AI kapanır", async () => {
    await plan(B, "AI");
    await subs.setOverride(admin, B.tenantId, { key: "maxMonthlyAiReplies", enabled: null, limitValue: 2, expiresAt: null, reason: "limit testi" });
    const e = await resolveEntitlements(B.tenantId);
    expect((await usageAllows(e, ["maxMonthlyAiReplies"])).allowed).toBe(true);
    await prisma.aiUsage.createMany({ data: [1, 2].map(() => ({ tenantId: B.tenantId, kind: "CHAT" as const, provider: "mock", success: true })) });
    expect(await usageAllows(e, ["maxMonthlyAiReplies"])).toEqual({ allowed: false, limit: "maxMonthlyAiReplies" });
    expect((await getUsage(B.tenantId, e)).maxMonthlyAiReplies).toBe(2);
    const access = await getVoiceAiAccess(B.tenantId);
    expect(access.availability).not.toEqual({ available: true });
    await subs.removeOverride(admin, B.tenantId, "maxMonthlyAiReplies");
  });
});

describe("izolasyon, yetki, geçmiş", () => {
  it("24. kiracı izolasyonu: A'nın paket değişikliği B'yi etkilemez; istisna kiracıya özel", async () => {
    await plan(A, "STARTER");
    await plan(B, "AI");
    await subs.setOverride(admin, A.tenantId, { key: "voice_ai", enabled: true, limitValue: null, expiresAt: null, reason: "izolasyon" });
    expect((await resolveEntitlements(A.tenantId)).has("voice_ai")).toBe(true);
    expect((await resolveEntitlements(A.tenantId)).has("ordering")).toBe(false);
    expect((await resolveEntitlements(B.tenantId)).has("ordering")).toBe(true);
    expect(await prisma.entitlementOverride.count({ where: { tenantId: B.tenantId, key: "voice_ai" } })).toBe(0);
    await subs.removeOverride(admin, A.tenantId, "voice_ai");
  });
  it("25. destek oturumu / kiracı kullanıcısı abonelik DEĞİŞTİREMEZ (yalnızca Super Admin)", async () => {
    const fd = new FormData();
    fd.append("plan", "AI");
    const tenantUser: CurrentSession = { id: "s", support: null, user: { id: A.userId, tenantId: A.tenantId, email: "x@y.z", firstName: "A", lastName: "B", role: "TENANT_OWNER", active: true, tenant: { id: A.tenantId, name: "A", slug: "a", status: "ACTIVE" } } };
    session = tenantUser;
    await expect(adminActions.activateSubscriptionAction(A.tenantId, null, fd)).rejects.toBeInstanceOf(NotFoundSignal);
    const before = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: A.tenantId } });
    expect(before.plan).toBe("STARTER");
    session = null;
  });
  it("26. abonelik olay geçmişi değiştirilemez; eski / yeni paket + durum; denetim kaydı eşleşir", async () => {
    const events = await prisma.subscriptionEvent.findMany({ where: { tenantId: A.tenantId }, orderBy: { createdAt: "asc" } });
    const changes = events.filter((e) => e.type === "SUBSCRIPTION_PLAN_CHANGED");
    expect(changes.length).toBeGreaterThan(4);
    expect(changes.every((e) => e.fromPlan && e.toPlan && e.fromPlan !== e.toPlan)).toBe(true);
    expect(events.some((e) => e.type === "SUBSCRIPTION_TRIAL_STARTED")).toBe(true);
    expect(events.some((e) => e.type === "SUBSCRIPTION_STATUS_CHANGED" && e.toStatus === "PAST_DUE")).toBe(true);
    expect(events.some((e) => e.type === "ENTITLEMENT_OVERRIDE_SET")).toBe(true);
    await expect(prisma.subscriptionEvent.update({ where: { id: events[0]!.id }, data: { type: "SUBSCRIPTION_REACTIVATED" } })).rejects.toThrow(/append-only/);
    const audits = await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "SUBSCRIPTION_PLAN_CHANGED" } });
    expect(audits).toBe(changes.length);
    // Tek güncel abonelik (kiracı başına benzersiz)
    await expect(prisma.subscription.create({ data: { tenantId: A.tenantId, plan: "AI", status: "ACTIVE" } })).rejects.toThrow();
    // Durum kısıtı: deneme bitiş tarihi zorunlu
    await expect(prisma.subscription.update({ where: { tenantId: A.tenantId }, data: { status: "TRIALING", trialEndsAt: null } })).rejects.toThrow();
  });
});
