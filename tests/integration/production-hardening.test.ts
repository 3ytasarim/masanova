import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { submitOrderSchema } = await import("@/lib/validation/orders");

/**
 * Sprint 11 — yeniden başlatma / çok süreç güvenliği, gerçek PostgreSQL (Neon). "Süreç" = taze modül örneği
 * (vi.resetModules + yeniden içe aktarma) ve kopup yeniden kurulan veritabanı bağlantısı: bellek içi hiçbir durum
 * (hız sınırı, önbellek, olay yolu) taşınmaz — bütünlük YALNIZCA veritabanı benzersizlik kısıtlarından gelir.
 */
const run = randomBytes(3).toString("hex");
let tenantId = "";
let ctx: { tenantId: string; branchId: string; tableId: string; tokenId: string; branchName: string; tableName: string; areaName: null; defaultLocale: string };

async function freshProcess() {
  await prisma.$disconnect(); // bağlantı havuzu kapanır; sonraki sorgu yeniden bağlanır
  vi.resetModules();
  return {
    orders: await import("@/server/services/orders/submit-order.service"),
    service: await import("@/server/services/service-requests/customer-request.service"),
    turns: await import("@/server/services/ai/turn.service"),
    conv: await import("@/server/services/ai/conversation.service"),
  };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Sertleştirme ${run}`,
      slug: `hard-${run}`,
      status: "ACTIVE",
      plan: "AI",
      settings: { create: { defaultLocale: "tr" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }] },
    },
    select: { id: true, branches: { select: { id: true } } },
  });
  tenantId = tenant.id;
  const branchId = tenant.branches[0]!.id;
  const station = await prisma.preparationStation.create({ data: { tenantId, branchId, name: "Mutfak" }, select: { id: true } });
  await prisma.branch.updateMany({ where: { id: branchId, tenantId }, data: { defaultStationId: station.id, defaultStationBranchId: branchId } });
  const category = await prisma.menuCategory.create({ data: { tenantId, name: "Çorbalar", slug: "corbalar" } });
  await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Çorba", slug: "corba", basePriceMinor: 12000 } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId, name: "Masa 1" } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  ctx = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.aiUsage.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  expect(await prisma.order.count({ where: { tenantId } })).toBe(0);
});

const order = (idempotencyKey: string) => submitOrderSchema.parse({ items: [{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 12000 }], note: null, idempotencyKey, locale: "tr" });

describe("yeniden başlatma sonrası sipariş / servis bütünlüğü (güvenlik testi 10)", () => {
  it("aynı sipariş anahtarı: yeniden başlatma + istemci yeniden denemesi → TEK sipariş", async () => {
    const key = randomBytes(18).toString("base64url");
    const p1 = await freshProcess();
    const first = await p1.orders.submitOrder(ctx, order(key));
    expect(first.kind).toBe("created");
    const p2 = await freshProcess(); // "süreç yeniden başladı"
    const retry = await p2.orders.submitOrder(ctx, order(key));
    expect(retry.kind).toBe("duplicate");
    expect("order" in retry && "order" in first && retry.order.publicId === first.order.publicId).toBe(true);
    expect(await prisma.order.count({ where: { tenantId, publicId: "order" in first ? first.order.publicId : "" } })).toBe(1);
  });

  it("iki süreç aynı anda aynı anahtarla gönderir → veritabanı tekliği tek sipariş bırakır", async () => {
    const key = randomBytes(18).toString("base64url");
    const a = await freshProcess();
    const b = await freshProcess();
    const results = await Promise.all([a.orders.submitOrder(ctx, order(key)), b.orders.submitOrder(ctx, order(key))]);
    expect(results.map((r) => r.kind).sort()).toEqual(["created", "duplicate"]);
    const created = results.find((r) => r.kind === "created");
    expect(await prisma.order.count({ where: { tenantId, publicId: created && "order" in created ? created.order.publicId : "" } })).toBe(1);
  });

  it("servis talebi: yeniden başlatma sonrası aynı talep → mevcut talep döner (Redis değil veritabanı garantisi)", async () => {
    const p1 = await freshProcess();
    const first = await p1.service.submitServiceRequest({ ...ctx, areaId: null }, { type: "WATER", note: null, recentOrderIds: [] });
    const p2 = await freshProcess();
    const again = await p2.service.submitServiceRequest({ ...ctx, areaId: null }, { type: "WATER", note: null, recentOrderIds: [] });
    expect([first.kind, again.kind]).toEqual(["created", "duplicate"]);
    expect(await prisma.tableServiceRequest.count({ where: { tenantId, type: "WATER" } })).toBe(1);
  });
});

describe("yeniden başlatma sonrası AI turu (güvenlik testi 11)", () => {
  async function conversation(p: Awaited<ReturnType<typeof freshProcess>>) {
    const scope = { tenantId, branchId: ctx.branchId, tableId: ctx.tableId };
    const { conversation } = await p.conv.createConversation(scope, { uiLocale: "tr", language: "tr", greeting: "Merhaba" });
    return conversation;
  }

  it("süreç ölürken yarıda kalan tur: kalp atışı yoksa TURN_STALE_MS sonra başka süreç sahiplenir; taze tur 'işleniyor'", async () => {
    const p1 = await freshProcess();
    const conv = await conversation(p1);
    const key = randomBytes(16).toString("base64url");
    const begun = await p1.turns.beginTurn(conv, key, "REALTIME");
    expect(begun.kind).toBe("new");
    // Aynı anda başka süreçten yeniden deneme → işleniyor
    const p2 = await freshProcess();
    expect((await p2.turns.beginTurn(conv, key, "REALTIME")).kind).toBe("in_progress");
    // Süreç sert biçimde öldü: kalp atışı durdu (updatedAt eskidi)
    await prisma.$executeRaw`UPDATE ai_turns SET updated_at = now() - interval '20 seconds' WHERE conversation_id = ${conv.id} AND turn_key = ${key}`;
    const reclaimed = await p2.turns.beginTurn(conv, key, "REALTIME");
    expect(reclaimed.kind).toBe("new");
    expect(reclaimed.kind === "new" && reclaimed.turn.attempts).toBe(2);
    expect(await prisma.aiTurn.count({ where: { conversationId: conv.id } })).toBe(1);
  });

  it("nazik kapanışta 'shutdown' işaretli tur yeni süreçte BEKLEMEDEN yeniden sahiplenilir; tamamlanmış tur yalnızca tekrar edilir", async () => {
    const p1 = await freshProcess();
    const conv = await conversation(p1);
    const key = randomBytes(16).toString("base64url");
    const begun = await p1.turns.beginTurn(conv, key, "REALTIME");
    if (begun.kind !== "new") throw new Error("expected new");
    await prisma.aiTurn.updateMany({ where: { id: begun.turn.id, assistantMessageId: null }, data: { status: "FAILED", errorCode: "shutdown" } });
    const p2 = await freshProcess();
    const again = await p2.turns.beginTurn(conv, key, "REALTIME");
    expect(again.kind).toBe("new");
    if (again.kind !== "new") return;
    await p2.conv.appendTurn(conv, { userText: "Ayran var mı?", inputMode: "VOICE", userLanguage: "tr", reply: "Evet.", replyLanguage: "tr", metadata: {}, inputTokens: 0, outputTokens: 0, turn: { id: again.turn.id, status: "COMPLETED", stats: {} } });
    const p3 = await freshProcess();
    const replay = await p3.turns.beginTurn(conv, key, "REALTIME");
    expect(replay.kind).toBe("replay");
    expect(await prisma.aiMessage.count({ where: { conversationId: conv.id, role: "USER" } })).toBe(1);
  });

  it("kalp atışı işlenen turu taze tutar (yanlışlıkla yeniden sahiplenilmez)", async () => {
    const p1 = await freshProcess();
    const conv = await conversation(p1);
    const key = randomBytes(16).toString("base64url");
    const begun = await p1.turns.beginTurn(conv, key, "FALLBACK");
    if (begun.kind !== "new") throw new Error("expected new");
    await prisma.$executeRaw`UPDATE ai_turns SET updated_at = now() - interval '12 seconds' WHERE id = ${begun.turn.id}`;
    const stop = p1.turns.startTurnHeartbeat(begun.turn.id);
    await new Promise((r) => setTimeout(r, p1.turns.TURN_HEARTBEAT_MS + 800));
    stop();
    const row = await prisma.aiTurn.findUniqueOrThrow({ where: { id: begun.turn.id } });
    expect(Date.now() - row.updatedAt.getTime()).toBeLessThan(p1.turns.TURN_STALE_MS);
    expect((await p1.turns.beginTurn(conv, key, "FALLBACK")).kind).toBe("in_progress");
  }, 20_000);
});

describe("AI konuşma saklama işi", () => {
  it("süresi uzun süre önce dolmuş konuşmalar (mesaj + tur) silinir; kullanım kayıtları KALIR; kuru çalıştırma yalnızca sayar", async () => {
    const { purgeExpiredConversations } = await import("@/server/services/ai/retention");
    const scope = { tenantId, branchId: ctx.branchId, tableId: ctx.tableId };
    const p = await freshProcess();
    const old = (await p.conv.createConversation(scope, { uiLocale: "tr", language: "tr", greeting: "Merhaba" })).conversation;
    const recent = (await p.conv.createConversation(scope, { uiLocale: "tr", language: "tr", greeting: "Merhaba" })).conversation;
    await prisma.aiTurn.create({ data: { tenantId, conversationId: old.id, turnKey: randomBytes(16).toString("base64url"), mode: "REALTIME", status: "COMPLETED" } });
    await prisma.aiUsage.create({ data: { tenantId, conversationId: old.id, kind: "CHAT", provider: "mock" } });
    await prisma.aiConversation.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 40 * 86_400_000) } });
    await prisma.aiConversation.update({ where: { id: recent.id }, data: { expiresAt: new Date(Date.now() - 5 * 86_400_000) } });

    const dry = await purgeExpiredConversations(prisma, { olderThanDays: 30, dryRun: true });
    expect(dry.matched).toBeGreaterThanOrEqual(1);
    expect(await prisma.aiConversation.count({ where: { id: old.id } })).toBe(1);
    const res = await purgeExpiredConversations(prisma, { olderThanDays: 30, batchSize: 1 });
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.aiConversation.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.aiMessage.count({ where: { conversationId: old.id } })).toBe(0);
    expect(await prisma.aiTurn.count({ where: { conversationId: old.id } })).toBe(0);
    expect(await prisma.aiConversation.count({ where: { id: recent.id } })).toBe(1);
    expect(await prisma.aiUsage.count({ where: { tenantId, conversationId: old.id } })).toBe(1);
    await expect(purgeExpiredConversations(prisma, { olderThanDays: 0 })).rejects.toThrow();
  });
});

describe("denetim kaydı taraması (veritabanındaki gerçek satırlar)", () => {
  it("hiçbir AuditLog satırı QR tokenı, parola, anahtar, kanıt, oturum ya da konuşma metni içermez", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = process.env.QR_TOKEN_SECRET!;
    const tokens = (await prisma.tableQrToken.findMany({ select: { tokenNonce: true }, take: 5000 })).map((t) => createHmac("sha256", secret).update(`masanova.table-qr.v1:${t.tokenNonce}`, "utf8").digest().subarray(0, 16).toString("base64url"));
    const rows = await prisma.auditLog.findMany({ select: { action: true, metadata: true }, orderBy: { createdAt: "desc" }, take: 20000 });
    const text = rows.map((r) => JSON.stringify(r.metadata ?? {})).join("\n");
    expect(rows.length).toBeGreaterThan(0);
    for (const token of tokens) expect(text.includes(token)).toBe(false);
    expect(text).not.toMatch(/"(password|parola|passwordHash|token|tokenHash|proof|proofHash|apiKey|api_key|sessionId|transcript|utterance|audio)"\s*:/i);
    expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{16,}|postgres(ql)?:\/\/[^"\s]+:[^"\s]+@|BEGIN PRIVATE KEY/);
    expect(text.includes(secret)).toBe(false);
  });
});
