import { randomBytes } from "node:crypto";
import type { StationType } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { clearAnalyticsCacheForTests } = await import("@/server/analytics/cache");
const { resolveAnalyticsContext } = await import("@/server/analytics/filter");
const { loadAdvisorFacts } = await import("@/server/services/advisor/facts.service");
const { loadAdvisor, refreshAdvisor, dismissInsight, setInsightFeedback, advisorOverview } = await import("@/server/services/advisor/advisor.service");
const { setAdvisorExplainerForTests, mockAdvisorExplainer } = await import("@/server/services/advisor/explainer");
const { tenantUsage } = await import("@/server/services/ai/usage.service");

/**
 * Sprint 15 — İşletme Danışmanı, gerçek PostgreSQL (Neon). Sabit "şimdi", deterministik geçici veri; mock açıklayıcı
 * (çağrı sayısı ölçülür). Sonunda kiracılar silinir.
 *   Şimdi: 2026-06-15 18:00 İstanbul. "Son 7 gün": 06-09 → şimdi; önceki eşdeğer dönem: 06-02 → 06-08 18:00.
 */
const NOW = new Date("2026-06-15T15:00:00Z");
const run = randomBytes(3).toString("hex");
const min = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const local = (day: string, hh: number, mm = 0) => new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+03:00`);

type Fx = Awaited<ReturnType<typeof makeTenant>>;
let A: Fx;
let B: Fx;
let seq = 1;
let explainCalls = 0;
const countingExplainer = {
  name: "mock",
  model: "advisor-mock",
  async explain(items: Parameters<typeof mockAdvisorExplainer.explain>[0]) {
    explainCalls++;
    return mockAdvisorExplainer.explain(items);
  },
};

async function makeTenant(label: string, plan: "AI" | "STARTER" = "AI") {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan, status: "ACTIVE", internal: true } },
      name: `Danışman ${label} ${run}`,
      slug: `adv-${label}-${run}`,
      status: "ACTIVE",
      plan,
      settings: { create: { defaultLocale: "tr", timezone: "Europe/Istanbul", defaultCurrency: "TRY" } },
      branches: { create: [{ name: "Merkez", slug: "merkez", timezone: "Europe/Istanbul" }, { name: "Kadıköy", slug: "kadikoy", timezone: "Europe/Istanbul" }] },
    },
    select: { id: true, branches: { orderBy: { slug: "desc" }, select: { id: true, name: true } } },
  });
  const tenantId = tenant.id;
  const [merkez, kadikoy] = tenant.branches as [{ id: string; name: string }, { id: string; name: string }];
  const bahce = await prisma.diningArea.create({ data: { tenantId, branchId: merkez.id, name: "Bahçe", slug: "bahce" } });
  const salon = await prisma.diningArea.create({ data: { tenantId, branchId: merkez.id, name: "İç Salon", slug: "ic-salon" } });
  const tBahce = await prisma.diningTable.create({ data: { tenantId, branchId: merkez.id, diningAreaId: bahce.id, name: "Masa 9" } });
  const tSalon = await prisma.diningTable.create({ data: { tenantId, branchId: merkez.id, diningAreaId: salon.id, name: "Masa 1" } });
  const tKadikoy = await prisma.diningTable.create({ data: { tenantId, branchId: kadikoy.id, name: "K1" } });
  const izgara = await prisma.preparationStation.create({ data: { tenantId, branchId: merkez.id, name: "Izgara", type: "GRILL" } });
  const tatli = await prisma.preparationStation.create({ data: { tenantId, branchId: merkez.id, name: "Tatlı", type: "DESSERT" } });
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Ana", slug: "ana" } });
  const burger = await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  const ayran = await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const eski = await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Eski Tatlı", slug: "eski", basePriceMinor: 20000 } });
  return { tenantId, scope: createTenantScope(tenantId), merkez, kadikoy, areas: { bahce, salon }, tables: { tBahce, tSalon, tKadikoy }, stations: { izgara, tatli }, products: { burger, ayran, eski } };
}

type Item = { product: { id: string; name: string }; qty: number; unit: number };
async function order(fx: Fx, spec: { table: { id: string; branchId: string; name: string }; area: string | null; at: Date; items: Item[]; prepMin: number; tickets?: { station: { id: string; name: string; type: StationType }; ready: number }[] }) {
  const total = spec.items.reduce((s, i) => s + i.unit * i.qty, 0);
  const accepted = min(spec.at, 1);
  const o = await prisma.order.create({
    data: {
      tenantId: fx.tenantId,
      branchId: spec.table.branchId,
      tableId: spec.table.id,
      publicId: randomBytes(16).toString("base64url"),
      orderNumber: seq++,
      status: "SERVED",
      currency: "TRY",
      subtotalMinor: total,
      totalMinor: total,
      itemCount: spec.items.reduce((s, i) => s + i.qty, 0),
      locale: "tr",
      branchName: "Merkez",
      tableName: spec.table.name,
      areaName: spec.area,
      idempotencyKeyHash: randomBytes(16).toString("hex"),
      requestHash: "it",
      submittedAt: spec.at,
      createdAt: spec.at,
      acceptedAt: accepted,
      preparingAt: min(accepted, 1),
      readyAt: min(accepted, spec.prepMin),
      servedAt: min(accepted, spec.prepMin + 3),
    },
  });
  let i = 0;
  for (const it of spec.items) {
    await prisma.orderItem.create({ data: { tenantId: fx.tenantId, orderId: o.id, productId: it.product.id, productName: it.product.name, productNameDefault: it.product.name, basePriceMinor: it.unit, modifiersTotalMinor: 0, unitPriceMinor: it.unit, quantity: it.qty, lineTotalMinor: it.unit * it.qty, sortOrder: i++ } });
  }
  for (const tk of spec.tickets ?? []) {
    await prisma.orderTicket.create({ data: { tenantId: fx.tenantId, branchId: spec.table.branchId, orderId: o.id, stationId: tk.station.id, stationName: tk.station.name, stationType: tk.station.type, status: "READY", createdAt: accepted, startedAt: min(accepted, 2), readyAt: min(accepted, tk.ready) } });
  }
  return o;
}

async function request(fx: Fx, table: { id: string; branchId: string; name: string }, areaId: string, areaName: string, at: Date, ackSec: number) {
  return prisma.tableServiceRequest.create({
    data: { tenantId: fx.tenantId, branchId: table.branchId, tableId: table.id, diningAreaId: areaId, publicId: randomBytes(16).toString("base64url"), type: "WAITER", status: "COMPLETED", activeSlot: null, branchName: "Merkez", areaName, tableName: table.name, createdAt: at, acknowledgedAt: new Date(at.getTime() + ackSec * 1000), completedAt: new Date(at.getTime() + (ackSec + 60) * 1000), acknowledgedByName: "Personel Adı Gizli" },
  });
}

async function aiTurns(fx: Fx, day: string, turns: number, fallback: number) {
  const conv = await prisma.aiConversation.create({ data: { tenantId: fx.tenantId, branchId: fx.merkez.id, tableId: fx.tables.tSalon.id, publicId: randomBytes(16).toString("base64url"), proofHash: randomBytes(32).toString("hex"), uiLocale: "tr", conversationLanguage: "tr", createdAt: local(day, 13), lastActivityAt: local(day, 13), expiresAt: local(day, 19) } });
  await prisma.aiMessage.create({ data: { tenantId: fx.tenantId, conversationId: conv.id, publicId: randomBytes(12).toString("base64url"), role: "USER", language: "tr", content: "GİZLİ MÜŞTERİ KONUŞMASI 0532", createdAt: local(day, 13) } });
  for (let i = 0; i < turns; i++) {
    await prisma.aiTurn.create({ data: { tenantId: fx.tenantId, conversationId: conv.id, turnKey: randomBytes(12).toString("base64url"), mode: i < fallback ? "FALLBACK" : "REALTIME", status: "COMPLETED", createdAt: min(local(day, 13), i) } });
  }
}

const CURRENT_DAYS = ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];
const PREVIOUS_DAYS = ["2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"];
const actorOf = (fx: Fx, canMutate = true) => ({ scope: fx.scope, userId: `u-${fx.tenantId.slice(-4)}`, canMutate });
const view = async (fx: Fx, q: { range?: string; branch?: string | null } = {}, canMutate = true) => {
  clearAnalyticsCacheForTests();
  const r = await loadAdvisor(actorOf(fx, canMutate), { range: "last7", ...q }, { now: NOW });
  if (!r.ok) throw new Error(r.error);
  return r.view;
};
const card = (v: { cards: { type: string; subject: string | null }[] }, type: string, subject?: string) => v.cards.find((c) => c.type === type && (subject === undefined || c.subject === subject));

beforeAll(async () => {
  clearAnalyticsCacheForTests();
  setAdvisorExplainerForTests(countingExplainer);
  A = await makeTenant("a");
  B = await makeTenant("b");
  const { burger, ayran, eski } = A.products;
  // Önceki dönem: 40 sipariş; hazırlama 9 dk; Burger 20, Eski Tatlı 25 (sonra arşivlenecek)
  for (let i = 0; i < 40; i++) {
    const day = PREVIOUS_DAYS[i % 5]!;
    const items: Item[] = [{ product: ayran, qty: 2, unit: 5000 }];
    if (i < 20) items.push({ product: burger, qty: 1, unit: 30000 });
    if (i < 25) items.push({ product: eski, qty: 1, unit: 20000 });
    await order(A, { table: i % 2 ? A.tables.tBahce : A.tables.tSalon, area: i % 2 ? "Bahçe" : "İç Salon", at: local(day, 12 + (i % 8), 10), items, prepMin: 9 });
  }
  // Bu dönem: 60 sipariş; hazırlama 12 dk; Burger 40, Eski Tatlı 10; 20 sipariş iki istasyonlu (Tatlı hep sonda)
  for (let i = 0; i < 60; i++) {
    const day = CURRENT_DAYS[i % 5]!;
    const items: Item[] = [{ product: ayran, qty: 1, unit: 5000 }];
    if (i < 40) items.push({ product: burger, qty: 1, unit: 30000 });
    if (i < 10) items.push({ product: eski, qty: 1, unit: 20000 });
    const tickets = i < 20 ? [{ station: A.stations.izgara, ready: 8 }, { station: A.stations.tatli, ready: 13 }] : undefined;
    // Saat dilimi sınırı: biri yerel 06-11 00:30 (UTC 06-10 21:30)
    const at = i === 0 ? new Date("2026-06-10T21:30:00Z") : local(day, 12 + (i % 8), 20);
    await order(A, { table: i % 2 ? A.tables.tBahce : A.tables.tSalon, area: i % 2 ? "Bahçe" : "İç Salon", at, items, prepMin: 12, tickets });
  }
  await prisma.product.update({ where: { id: eski.id }, data: { archivedAt: NOW } });
  // Servis: önceki 20 talep 2 dk; bu dönem Bahçe 10 × 4 dk, İç Salon 10 × 2 dk
  for (let i = 0; i < 20; i++) await request(A, A.tables.tSalon, A.areas.salon.id, "İç Salon", local(PREVIOUS_DAYS[i % 5]!, 14, i), 120);
  for (let i = 0; i < 10; i++) await request(A, A.tables.tBahce, A.areas.bahce.id, "Bahçe", local(CURRENT_DAYS[i % 5]!, 14, i), 240);
  for (let i = 0; i < 10; i++) await request(A, A.tables.tSalon, A.areas.salon.id, "İç Salon", local(CURRENT_DAYS[i % 5]!, 15, i), 120);
  // AI: önceki 30 tur (3 bas-konuş), bu dönem 30 tur (15 bas-konuş)
  await aiTurns(A, "2026-06-04", 30, 3);
  await aiTurns(A, "2026-06-12", 30, 15);
  // Kadıköy: yalnızca 3 sipariş (şube filtresi + az veri)
  for (let i = 0; i < 3; i++) await order(A, { table: A.tables.tKadikoy, area: null, at: local(CURRENT_DAYS[i]!, 13), items: [{ product: ayran, qty: 1, unit: 5000 }], prepMin: 5 });
  // B: az veri
  for (let i = 0; i < 3; i++) await order(B, { table: B.tables.tSalon, area: "İç Salon", at: local(CURRENT_DAYS[i]!, 13), items: [{ product: B.products.burger, qty: 1, unit: 30000 }], prepMin: 30 });
});

beforeEach(() => clearAnalyticsCacheForTests());

afterAll(async () => {
  setAdvisorExplainerForTests(undefined);
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  expect(await prisma.advisorInsight.count({ where: { tenantId: { in: ids } } })).toBe(0);
});

describe("deterministik içgörüler (Neon)", () => {
  it("1–2. sipariş artışı ve ortalama sipariş içgörüsü — olgular sorgudan", async () => {
    const v = await view(A);
    expect(card(v, "ORDER_VOLUME_CHANGE")).toMatchObject({ severity: "INFO" });
    const vol = v.cards.find((c) => c.type === "ORDER_VOLUME_CHANGE")!;
    expect(vol.rendered.comparison).toBe("40 → 63 (+%58)"); // tüm şubeler: Merkez 60 + Kadıköy 3
    const avg = v.cards.find((c) => c.type === "AVERAGE_ORDER_CHANGE")!;
    // önceki: (20×300 + 40×100 + 25×200) / 40 = 375 ₺; bu dönem: (60×50 + 40×300 + 10×200 + 3×50) / 63 = 272,22 ₺
    expect(avg.rendered.comparison).toBe("₺375 → ₺272 (−%27)");
    expect(avg.severity).toBe("ATTENTION");
  });

  it("3. az veri bastırma: B (3 sipariş) ve Kadıköy şubesi içgörü üretmez", async () => {
    expect((await view(B)).cards).toEqual([]);
    expect((await view(A, { branch: A.kadikoy.id })).cards).toEqual([]);
  });

  it("4–5. ürün ivmesi: Burger yükseliyor; arşivlenmiş ürünün düşüşü içgörü değil (geçmiş satış okunur)", async () => {
    const v = await view(A);
    const up = v.cards.find((c) => c.type === "PRODUCT_MOMENTUM" && c.subject === "Burger");
    expect(up?.rendered.comparison).toBe("20 → 40 adet (+%100)");
    expect(v.cards.some((c) => c.subject === "Eski Tatlı" && c.type === "PRODUCT_MOMENTUM")).toBe(false);
    const ctx = await resolveAnalyticsContext(A.scope, { range: "last7" }, NOW);
    if (!ctx.ok) throw new Error();
    const f = await loadAdvisorFacts(ctx.context);
    expect(f.current.products.find((p) => p.name === "Eski Tatlı")).toMatchObject({ archived: true, quantity: 10 });
  });

  it("6. hazırlama süresi içgörüsü (medyan 9 dk → 12 dk)", async () => {
    const c = (await view(A)).cards.find((x) => x.type === "PREP_TIME_CHANGE")!;
    expect(c.rendered.comparison).toBe("9 dk 00 sn → 12 dk 00 sn (+%33)");
    expect(c.metrics.find((m) => m.label === "Sipariş (örneklem)")).toMatchObject({ current: "63", previous: "40" });
  });

  it("7. çok istasyonlu darboğaz: Tatlı 20 siparişin 20'sinde son", async () => {
    const c = (await view(A)).cards.find((x) => x.type === "STATION_BOTTLENECK")!;
    expect(c).toMatchObject({ subject: "Tatlı" });
    expect(c.rendered.finding).toContain("20 siparişin 20 tanesinde (%100)");
  });

  it("8–9. servis yanıtı yavaşladı; Bahçe ↔ İç Salon farkı (personel adı yok)", async () => {
    const v = await view(A);
    expect(v.cards.find((x) => x.type === "SERVICE_RESPONSE_CHANGE")!.rendered.comparison).toBe("2 dk 00 sn → 3 dk 00 sn (+%50)");
    const gap = v.cards.find((x) => x.type === "AREA_SERVICE_GAP")!;
    expect(gap).toMatchObject({ subject: "Bahçe" });
    expect(JSON.stringify(v)).not.toContain("Personel Adı Gizli");
  });

  it("10. AI kullanım anomalisi: bas-konuşa düşme %10 → %50; konuşma içeriği hiçbir yerde yok", async () => {
    const v = await view(A);
    expect(v.cards.find((x) => x.type === "AI_FALLBACK_CHANGE")!.rendered.comparison).toBe("%10 → %50");
    const ctx = await resolveAnalyticsContext(A.scope, { range: "last7" }, NOW);
    if (!ctx.ok) throw new Error();
    const facts = await loadAdvisorFacts(ctx.context);
    const everything = JSON.stringify([v, facts, await prisma.advisorInsight.findMany({ where: { tenantId: A.tenantId } })]);
    expect(everything).not.toContain("GİZLİ MÜŞTERİ");
    expect(everything).not.toContain("0532");
  });

  it("11. şube filtresi: başka kiracının şubesi reddedilir; kapsam açıkça belirtilir", async () => {
    const r = await loadAdvisor(actorOf(A), { range: "last7", branch: B.merkez.id }, { now: NOW });
    expect(r).toMatchObject({ ok: false, error: "branch_invalid" });
    const merkez = await view(A, { branch: A.merkez.id });
    expect(merkez.branchName).toBe("Merkez");
    expect(merkez.cards.length).toBeGreaterThan(0);
  });

  it("12. saat dilimi sınırı: UTC 06-10 21:30 → yerel 06-11 günü", async () => {
    const ctx = await resolveAnalyticsContext(A.scope, { range: "last7" }, NOW);
    if (!ctx.ok) throw new Error();
    const daily = (await loadAdvisorFacts(ctx.context)).detail.daily;
    const d10 = daily.find((d) => d.day === "2026-06-10")!.orders;
    const d11 = daily.find((d) => d.day === "2026-06-11")!.orders;
    expect(d11).toBe(d10 + 1 + 1); // 06-11: 12 + sınır siparişi; 06-10: 11 (bir sipariş 06-11'e kaydı) + Kadıköy 1 her birinde
    expect(daily).toHaveLength(29);
    expect(daily.at(-1)!.day).toBe("2026-06-14");
  });
});

describe("kalıcılık, kapatma, AI açıklaması (Neon)", () => {
  it("13. kiracı yalıtımı: B, A'nın içgörüsünü göremez / kapatamaz", async () => {
    const v = await view(A);
    const id = v.cards[0]!.id!;
    expect(await dismissInsight(actorOf(B), id)).toBe(false);
    expect(await setInsightFeedback(actorOf(B), id, "USEFUL")).toBe(false);
    expect((await prisma.advisorInsight.findUniqueOrThrow({ where: { id } })).status).not.toBe("DISMISSED");
    expect((await view(B)).cards.some((c) => c.id === id)).toBe(false);
  });

  it("14. kayıtlar yeniden kullanılır (aynı kimlik, yeni → görüldü); destek modu hiçbir şey yazmaz", async () => {
    const first = await view(A);
    const second = await view(A);
    expect(second.cards.map((c) => c.id)).toEqual(first.cards.map((c) => c.id));
    expect(second.cards.every((c) => !c.isNew)).toBe(true);
    const before = await prisma.advisorInsight.findMany({ where: { tenantId: A.tenantId }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true, status: true } });
    await view(A, {}, false);
    const after = await prisma.advisorInsight.findMany({ where: { tenantId: A.tenantId }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true, status: true } });
    expect(after).toEqual(before);
    expect(await refreshAdvisor(actorOf(A, false), { range: "last7" }, { now: NOW })).toMatchObject({ ok: false });
  });

  it("16. AI açıklaması: doğrulanır, saklanır; AYNI olgular → yeniden istek yok", async () => {
    explainCalls = 0;
    const r1 = await refreshAdvisor(actorOf(A), { range: "last7" }, { now: NOW });
    expect(r1).toMatchObject({ ok: true, fallback: false });
    expect(explainCalls).toBe(1);
    const v = await view(A);
    expect(v.cards.filter((c) => c.explanation.source === "ai").length).toBeGreaterThan(0);
    const r2 = await refreshAdvisor(actorOf(A), { range: "last7" }, { now: NOW });
    expect(r2).toMatchObject({ ok: true, explained: 0 });
    expect(explainCalls).toBe(1);
    // Aynı olgular başka kapsamda (Merkez şubesi) → önceki açıklama YENİDEN kullanılır, çağrı yok
    const r3 = await refreshAdvisor(actorOf(A), { range: "last7", branch: A.merkez.id }, { now: NOW });
    expect(r3.ok && r3.reused).toBeGreaterThan(0);
    const usage = await prisma.aiUsage.findMany({ where: { tenantId: A.tenantId, kind: "ADVISOR" } });
    expect(usage.length).toBeGreaterThanOrEqual(1);
    // Müşteri sesli AI kullanım özeti danışman kullanımını İÇERMEZ
    const voice = await tenantUsage(A.tenantId, "Europe/Istanbul", NOW);
    expect(voice.month.inputTokens + voice.today.inputTokens).toBe(0);
  });

  it("güvenlik: AI uydurma sayı / kâr iddiası yazarsa reddedilir → şablon; aynı olgularla tekrar denenmez", async () => {
    await prisma.advisorInsight.updateMany({ where: { tenantId: A.tenantId }, data: { explanation: Prisma_DbNull(), explanationHash: null } });
    let calls = 0;
    setAdvisorExplainerForTests({
      name: "evil",
      model: "evil-1",
      async explain(items) {
        calls++;
        return { items: items.map((i, k) => ({ id: i.id, summary: k % 2 ? "Kârınız %80 arttı." : "Sipariş sayısı 999 oldu.", whyItMatters: "x", suggestedAction: "y" })), inputTokens: 10, outputTokens: 10 };
      },
    });
    const r = await refreshAdvisor(actorOf(A), { range: "last7" }, { now: NOW });
    expect(r).toMatchObject({ ok: true, explained: 0 });
    expect(r.ok && r.rejected).toBeGreaterThan(0);
    const v = await view(A);
    expect(v.cards.every((c) => c.explanation.source === "template")).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/999|Kârınız/);
    const rows = await prisma.advisorInsight.findMany({ where: { tenantId: A.tenantId, explanationModel: { startsWith: "rejected:" } } });
    expect(rows.map((x) => x.explanationModel)).toEqual(expect.arrayContaining(["rejected:number"]));
    await refreshAdvisor(actorOf(A), { range: "last7" }, { now: NOW });
    expect(calls).toBe(1);
    setAdvisorExplainerForTests(countingExplainer);
  });

  it("sağlayıcı yok / hata → deterministik danışman çalışmaya devam eder", async () => {
    await prisma.advisorInsight.updateMany({ where: { tenantId: A.tenantId }, data: { explanation: Prisma_DbNull(), explanationHash: null } });
    setAdvisorExplainerForTests(null);
    expect(await refreshAdvisor(actorOf(A), { range: "last7" }, { now: NOW })).toMatchObject({ ok: true, fallback: true });
    expect((await view(A)).cards.length).toBeGreaterThan(0);
    setAdvisorExplainerForTests({ name: "down", model: "x", explain: async () => Promise.reject(new Error("timeout")) });
    expect(await refreshAdvisor(actorOf(A), { range: "last7" }, { now: NOW })).toMatchObject({ ok: true, fallback: true });
    expect(await prisma.aiUsage.count({ where: { tenantId: A.tenantId, kind: "ADVISOR", success: false } })).toBeGreaterThan(0);
    setAdvisorExplainerForTests(countingExplainer);
  });

  it("15. kapatma: kapatılan gizli kalır; önemli değişim olunca yeniden görünür", async () => {
    let v = await view(A);
    const vol = v.cards.find((c) => c.type === "ORDER_VOLUME_CHANGE")!;
    expect(await dismissInsight(actorOf(A), vol.id!)).toBe(true);
    v = await view(A);
    expect(v.cards.some((c) => c.type === "ORDER_VOLUME_CHANGE")).toBe(false);
    expect(v.dismissedCount).toBeGreaterThanOrEqual(1);
    // Küçük değişim (1 sipariş daha) → aynı imza, kapalı kalır
    await order(A, { table: A.tables.tSalon, area: "İç Salon", at: local("2026-06-14", 16), items: [{ product: A.products.ayran, qty: 2, unit: 5000 }], prepMin: 12 });
    expect((await view(A)).cards.some((c) => c.type === "ORDER_VOLUME_CHANGE")).toBe(false);
    // Önemli değişim (sipariş artışı +%50 → +%150 kovası) → yeniden "yeni"
    for (let i = 0; i < 40; i++) await order(A, { table: A.tables.tSalon, area: "İç Salon", at: local(CURRENT_DAYS[i % 5]!, 20, 30), items: [{ product: A.products.ayran, qty: 1, unit: 5000 }], prepMin: 12 });
    v = await view(A);
    const reopened = v.cards.find((c) => c.type === "ORDER_VOLUME_CHANGE");
    expect(reopened?.isNew).toBe(true);
    expect(reopened?.rendered.comparison).toBe("40 → 104 (+%160)");
    // Geri bildirim kalıcı
    expect(await setInsightFeedback(actorOf(A), reopened!.id!, "USEFUL")).toBe(true);
    expect((await prisma.advisorInsight.findUniqueOrThrow({ where: { id: reopened!.id! } })).feedback).toBe("USEFUL");
  });

  it("paket kapısı: STARTER kiracı danışmanı ve AI açıklamasını çağıramaz", async () => {
    await prisma.subscription.update({ where: { tenantId: B.tenantId }, data: { plan: "STARTER" } });
    explainCalls = 0;
    expect(await loadAdvisor(actorOf(B), { range: "last7" }, { now: NOW })).toEqual({ ok: false, error: "feature" });
    expect(await refreshAdvisor(actorOf(B), { range: "last7" }, { now: NOW })).toMatchObject({ ok: false, error: "feature" });
    expect(await advisorOverview(actorOf(B))).toBeNull();
    expect(explainCalls).toBe(0);
    await prisma.subscription.update({ where: { tenantId: B.tenantId }, data: { plan: "AI" } });
  });
});

function Prisma_DbNull() {
  // Json? alanını NULL yapmak için Prisma.DbNull (dinamik içe aktarımla).
  return PrismaNs.DbNull;
}
const { Prisma: PrismaNs } = await import("@prisma/client");
