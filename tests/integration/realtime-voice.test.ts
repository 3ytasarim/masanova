import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LiveTurnEvent } from "@/lib/ai/realtime";
import type { TrustedTableContext } from "@/lib/tenant/table-qr-context";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { createMockStt, createMockTts, createRuleBasedProvider } = await import("@/server/services/ai/providers/mock");
const { resetProvidersForTests } = await import("@/server/services/ai/config");
const { startOrResumeSession, runTurn } = await import("@/server/services/ai/assistant.service");
const { runLiveTurn, reportLiveTurn } = await import("@/server/services/ai/realtime.service");
const { saveAiSettings } = await import("@/server/services/ai/settings.service");
const { hashProof } = await import("@/server/services/ai/conversation.service");
const { voiceRange } = await import("@/server/services/ai/usage.service");

/**
 * Sprint 10 — canlı sesli tur, gerçek PostgreSQL (Neon) + mock sağlayıcılar. Geçici kiracılar; sonunda silinir.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };
const providers = { ai: createRuleBasedProvider(), stt: createMockStt(), tts: createMockTts() };

async function makeTenant(label: string, plan: "AI" | "PRO") {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan, status: "ACTIVE", internal: true } },
      name: `Canlı ${label} ${run}`,
      slug: `canli-${label}-${run}`,
      status: "ACTIVE",
      plan,
      settings: { create: { defaultLocale: "tr", timezone: "Europe/Istanbul" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }] },
      users: { create: { email: `canli-${label}-${run}@masanovai.test`, firstName: "C", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, name: true, slug: true, branches: { select: { id: true, name: true } }, users: { select: { id: true } } },
  });
  const tenantId = tenant.id;
  const branch = tenant.branches[0]!;
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Yemekler", slug: "yemekler" } });
  const drinks = await prisma.menuCategory.create({ data: { tenantId, name: "İçecekler", slug: "icecekler" } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Tavuk Şiş", slug: "tavuk-sis", basePriceMinor: 30000, shortDescription: "Izgara tavuk" } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Acılı Adana", slug: "acili-adana", basePriceMinor: 32000, shortDescription: "Acı biberli kebap" } });
  await prisma.product.create({ data: { tenantId, categoryId: drinks.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const tables = await Promise.all([1, 2].map((n) => prisma.diningTable.create({ data: { tenantId, branchId: branch.id, name: `Masa ${n}` } })));
  const ctxs = await Promise.all(
    tables.map(async (t) => {
      const tk = await prisma.tableQrToken.create({ data: { tenantId, branchId: branch.id, tableId: t.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
      return {
        tenant: { id: tenantId, name: tenant.name, slug: tenant.slug, status: "ACTIVE", domain: { hostname: `${tenant.slug}.localhost`, type: "SUBDOMAIN", isPrimary: true } },
        branch: { id: branch.id, name: branch.name },
        area: null,
        table: { id: t.id, name: t.name, number: null },
        token: { id: tk.id, status: "active" },
        scope: createTenantScope(tenantId),
      } as unknown as TrustedTableContext;
    }),
  );
  if (plan === "AI") {
    await saveAiSettings({ userId: tenant.users[0]!.id, scope: createTenantScope(tenantId), meta }, { enabled: true, assistantName: "Masa Asistanı", welcomeMessage: null, tone: "WARM", customInstructions: null, allowRecommendations: true, allowCartActions: true, allowServiceActions: true, voiceEnabled: true, defaultVoiceLanguage: null });
  }
  return { tenantId, t1: ctxs[0]!, t2: ctxs[1]! };
}

let A: Awaited<ReturnType<typeof makeTenant>>;
let P: Awaited<ReturnType<typeof makeTenant>>;

const ip = () => `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const key = () => randomBytes(16).toString("base64url");
async function proofFor(ctx: TrustedTableContext): Promise<string> {
  const s = await startOrResumeSession(ctx, { proof: null, uiLocale: "tr", ip: ip(), realtimeAvailable: true });
  if (!s.ok || !s.proof) throw new Error("session");
  return s.proof;
}
const mockAudio = (text: string, low = false) => ({ bytes: new TextEncoder().encode(`MOCK-STT${low ? "-LOW" : ""}:${text}`), mimeType: "audio/wav", clientDurationMs: 1800 });

async function live(ctx: TrustedTableContext, proof: string, input: { text?: string; say?: string; low?: boolean; turnKey?: string; muted?: boolean }) {
  const turnKey = input.turnKey ?? key();
  const stream = runLiveTurn(
    ctx,
    { proof, ip: ip(), text: input.text ?? null, audio: input.say ? mockAudio(input.say, input.low) : null, cart: [], recentOrders: [], turnKey, muted: !!input.muted },
    new AbortController().signal,
  );
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let dropped = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }
  } catch {
    dropped = true;
  }
  const events = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as LiveTurnEvent);
  const of = <T extends LiveTurnEvent["t"]>(t: T) => events.filter((e) => e.t === t) as Extract<LiveTurnEvent, { t: T }>[];
  return { turnKey, events, dropped, of, done: of("done")[0], error: of("error")[0], actions: of("actions")[0] };
}
const conversationOf = (proof: string) => prisma.aiConversation.findFirstOrThrow({ where: { proofHash: hashProof(proof) } });
const counts = async (proof: string) => {
  const c = await conversationOf(proof);
  return { messages: await prisma.aiMessage.count({ where: { conversationId: c.id } }), chat: await prisma.aiUsage.count({ where: { conversationId: c.id, kind: "CHAT" } }), turns: await prisma.aiTurn.count({ where: { conversationId: c.id } }) };
};

beforeAll(async () => {
  resetProvidersForTests(providers);
  A = await makeTenant("a", "AI");
  P = await makeTenant("p", "PRO");
});

afterAll(async () => {
  resetProvidersForTests();
  const ids = [A?.tenantId, P?.tenantId].filter(Boolean) as string[];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  expect(await prisma.aiTurn.count({ where: { tenantId: { in: ids } } })).toBe(0);
});

describe("canlı tur akışı", () => {
  it("1. olay sırası: kabul → metin → cümle metni → ses → kartlar (kayıttan SONRA) → bitti; tur ölçümleri kaydedilir", async () => {
    const proof = await proofFor(A.t1);
    const r = await live(A.t1, proof, { say: "İki ayran ekle" });
    const order = r.events.map((e) => e.t);
    expect(order[0]).toBe("accepted");
    expect(order[1]).toBe("transcript");
    expect(order.indexOf("text")).toBeGreaterThan(1);
    expect(order).toContain("audio");
    expect(order.indexOf("actions")).toBeGreaterThan(order.lastIndexOf("text"));
    expect(order.at(-1)).toBe("done");
    expect(r.actions!.actions).toEqual([expect.objectContaining({ kind: "cart_add" })]);
    expect(r.done!.replayed).toBe(false);
    expect(r.done!.metrics.sttMs).not.toBeNull();
    expect(r.done!.metrics.firstAudioMs).not.toBeNull();
    // Metin, kaydedilen yanıtla aynı (cümleler korumadan geçmiş)
    expect(r.of("text").map((e) => e.text).join(" ")).toBe(r.done!.text);
    const conv = await conversationOf(proof);
    const turn = await prisma.aiTurn.findFirstOrThrow({ where: { conversationId: conv.id, turnKey: r.turnKey } });
    expect(turn).toMatchObject({ mode: "REALTIME", status: "COMPLETED", attempts: 1 });
    expect(turn.audioInMs).toBeGreaterThan(0); // STT sağlayıcısının bildirdiği süre
    expect(turn.assistantMessageId).not.toBeNull();
    expect(turn.firstAudioMs).not.toBeNull();
    // Model hiçbir şey göndermedi
    expect(await prisma.order.count({ where: { tenantId: A.tenantId } })).toBe(0);
  });

  it("2. aynı tur anahtarı tekrar: yeniden üretim yok — aynı mesaj, ses yok, yinelenen mesaj / kullanım yok", async () => {
    const proof = await proofFor(A.t1);
    const first = await live(A.t1, proof, { say: "Ayran var mı?" });
    const before = await counts(proof);
    const again = await live(A.t1, proof, { say: "Ayran var mı?", turnKey: first.turnKey });
    expect(again.done).toMatchObject({ replayed: true, messageId: first.done!.messageId, text: first.done!.text });
    expect(again.of("audio")).toHaveLength(0);
    expect(await counts(proof)).toEqual(before);
    expect((await prisma.aiTurn.findFirstOrThrow({ where: { turnKey: first.turnKey } })).attempts).toBe(2);
  });

  it("3. eşzamanlı aynı tur: yalnızca biri işlenir, diğeri 'işleniyor' ya da tekrar alır", async () => {
    const proof = await proofFor(A.t1);
    const turnKey = key();
    const [a, b] = await Promise.all([live(A.t1, proof, { say: "Tavuk şiş var mı?", turnKey }), live(A.t1, proof, { say: "Tavuk şiş var mı?", turnKey })]);
    const outcomes = [a, b].map((r) => (r.done ? (r.done.replayed ? "replay" : "new") : r.error!.code));
    expect(outcomes.filter((o) => o === "new")).toHaveLength(1);
    expect(outcomes.every((o) => ["new", "replay", "in_progress"].includes(o))).toBe(true);
    expect((await counts(proof)).messages).toBe(3); // karşılama + 1 tur
  });

  it("4. bağlantı kopması (kayıttan sonra, 'done' öncesi) → aynı anahtarla yeniden bağlanma → tek kayıt", async () => {
    const proof = await proofFor(A.t1);
    const lost = await live(A.t1, proof, { say: "Ayran var mı? #drop" });
    expect(lost.dropped).toBe(true);
    expect(lost.done).toBeUndefined();
    expect(lost.actions).toBeUndefined();
    const retry = await live(A.t1, proof, { say: "Ayran var mı? #drop", turnKey: lost.turnKey });
    expect(retry.done!.replayed).toBe(true);
    expect(retry.of("text").length).toBeGreaterThan(0);
    expect(await counts(proof)).toEqual({ messages: 3, chat: 1, turns: 1 });
  });

  it("5. sağlayıcı yok → provider_unavailable; bekleyen ifade bas-konuşa AYNI anahtarla devredilir (çift kayıt yok)", async () => {
    const proof = await proofFor(A.t1);
    const down = await live(A.t1, proof, { say: "Ayran var mı #down" });
    expect(down.error).toEqual({ t: "error", code: "provider_unavailable", retryable: false });
    const conv = await conversationOf(proof);
    expect(await prisma.aiTurn.findFirstOrThrow({ where: { conversationId: conv.id, turnKey: down.turnKey } })).toMatchObject({ status: "FAILED", errorCode: "provider_unavailable" });
    const fb = await runTurn(A.t1, { proof, ip: ip(), text: null, audio: mockAudio("Ayran var mı?"), cart: [], recentOrders: [], turnKey: down.turnKey });
    expect(fb.ok).toBe(true);
    const again = await runTurn(A.t1, { proof, ip: ip(), text: null, audio: mockAudio("Ayran var mı?"), cart: [], recentOrders: [], turnKey: down.turnKey });
    expect(again.ok && fb.ok && again.reply.messageId).toBe(fb.ok && fb.reply.messageId);
    expect(await prisma.aiTurn.findFirstOrThrow({ where: { conversationId: conv.id, turnKey: down.turnKey } })).toMatchObject({ mode: "FALLBACK", status: "COMPLETED" });
    expect(await counts(proof)).toEqual({ messages: 3, chat: 1, turns: 1 });
  });
});

describe("araya girme", () => {
  it("6. oynatma sırasında kesme raporu: tur INTERRUPTED, çalınan süre kaydedilir, tekrarında kart YOK", async () => {
    const proof = await proofFor(A.t1);
    const r = await live(A.t1, proof, { say: "İki ayran ekle" });
    expect(r.actions!.actions).toHaveLength(1);
    expect(await reportLiveTurn(A.t1, { proof, ip: ip(), turnKey: r.turnKey, playedMs: 1234.4, interrupted: true })).toEqual({ ok: true });
    expect(await reportLiveTurn(A.t1, { proof, ip: ip(), turnKey: r.turnKey, playedMs: 900, interrupted: true })).toEqual({ ok: true }); // tekrar zararsız
    const turn = await prisma.aiTurn.findFirstOrThrow({ where: { turnKey: r.turnKey } });
    expect(turn).toMatchObject({ status: "INTERRUPTED", audioOutMs: 1234 });
    expect(turn.interruptedAt).not.toBeNull();
    const replay = await live(A.t1, proof, { say: "İki ayran ekle", turnKey: r.turnKey });
    expect(replay.actions!.actions).toEqual([]);
    expect(replay.actions!.recommendation).toBeNull();
  });

  it("7. kayıttan ÖNCE gelen kesme: yanıt kesildi olarak kaydedilir; başka konuşmanın kanıtı tura dokunamaz", async () => {
    const proof = await proofFor(A.t1);
    const other = await proofFor(A.t1);
    const turnKey = key();
    const conv = await conversationOf(proof);
    await prisma.aiTurn.create({ data: { tenantId: A.tenantId, conversationId: conv.id, turnKey, mode: "REALTIME", status: "FAILED", interruptedAt: new Date() } });
    const r = await live(A.t1, proof, { say: "İki ayran ekle", turnKey });
    expect(r.done).toBeDefined();
    const turn = await prisma.aiTurn.findFirstOrThrow({ where: { conversationId: conv.id, turnKey } });
    expect(turn.status).toBe("INTERRUPTED");
    const msg = await prisma.aiMessage.findUniqueOrThrow({ where: { id: turn.assistantMessageId! } });
    expect((msg.metadata as { interrupted?: boolean }).interrupted).toBe(true);
    expect(await reportLiveTurn(A.t1, { proof: other, ip: ip(), turnKey, playedMs: 1, interrupted: true })).toEqual({ ok: false, error: "not_found" });
    expect(await reportLiveTurn(A.t2, { proof, ip: ip(), turnKey, playedMs: 1, interrupted: true })).toEqual({ ok: false, error: "conversation_invalid" });
  });
});

describe("anlama, dil ve bağlam", () => {
  it("8. düşük güvenli konuşma metni → tahmin yok: 'Sizi tam anlayamadım. Tekrar eder misiniz?' (araç / model yok)", async () => {
    const proof = await proofFor(A.t1);
    const r = await live(A.t1, proof, { say: "ayr.. şey.. ekl", low: true });
    expect(r.of("transcript")[0]!.confidence).toBeLessThan(0.55);
    expect(r.done!.text).toBe("Sizi tam anlayamadım. Tekrar eder misiniz?");
    expect(r.actions!.actions).toEqual([]);
    expect((await counts(proof)).chat).toBe(0);
  });

  it("9. karışık dil Türkçede kalır; açık geçiş bir kez onaylanır ve dil olayı gelir", async () => {
    const proof = await proofFor(A.t1);
    const mixed = await live(A.t1, proof, { say: "Bir chicken burger önerir misin?" });
    expect(mixed.of("language")).toHaveLength(0);
    expect(mixed.done!.language).toBe("tr");
    const en = await live(A.t1, proof, { say: "Can we continue in English?" });
    expect(en.of("language")).toEqual([{ t: "language", language: "en", direction: "ltr", acknowledged: true }]);
    expect(en.done!.text.match(/Of course/g)).toHaveLength(1);
    const stay = await live(A.t1, proof, { say: "What do you recommend?" });
    expect(stay.of("language")).toHaveLength(0);
    expect(stay.done!.language).toBe("en");
  });

  it("10. öneri + kesinti + kısıt: '3 kişiyiz, birimiz vegan, 1500 lirayı geçmeyelim' → 'Acı da olmasın' iki kısıtı birlikte kullanır", async () => {
    const proof = await proofFor(A.t1);
    const first = await live(A.t1, proof, { say: "3 kişiyiz, birimiz vegan, 1500 lirayı geçmeyelim" });
    const rec1 = first.actions!.recommendation!;
    expect(rec1.totalMinor).toBeLessThanOrEqual(150000);
    expect(first.done!.text).toMatch(/vegan/i); // etiketli vegan yemek yok → açıkça söylenir (uydurma yok)
    await reportLiveTurn(A.t1, { proof, ip: ip(), turnKey: first.turnKey, playedMs: 700, interrupted: true });
    const second = await live(A.t1, proof, { say: "Acı da olmasın" });
    const rec2 = second.actions!.recommendation!;
    expect(rec2).not.toBeNull();
    expect(rec2.totalMinor).toBeLessThanOrEqual(150000);
    expect(rec2.items.some((i) => i.product === "acili-adana")).toBe(false);
    const ctx = (await conversationOf(proof)).context as { guests: number; budgetMinor: number; spicy: string; diets: { tag: string }[] };
    expect(ctx).toMatchObject({ guests: 3, budgetMinor: 150000, spicy: "avoid", diets: [{ tag: "vegan", guests: 1 }] });
  });
});

describe("yetki, izolasyon ve ölçüm", () => {
  it("11. kapı + kanıt + masa: paket yoksa feature_disabled; başka masanın kanıtı geçmez; aynı anahtar başka konuşmada bağımsız", async () => {
    const pro = await live(P.t1, "x".repeat(43), { text: "Merhaba" });
    expect(pro.error).toMatchObject({ code: "feature_disabled" });
    const proof = await proofFor(A.t1);
    const wrongTable = await live(A.t2, proof, { text: "Merhaba" });
    expect(wrongTable.error).toMatchObject({ code: "conversation_invalid" });
    const shared = key();
    const one = await live(A.t1, proof, { text: "Ayran var mı?", turnKey: shared });
    const proof2 = await proofFor(A.t2);
    const two = await live(A.t2, proof2, { text: "Ayran var mı?", turnKey: shared });
    expect(one.done!.replayed).toBe(false);
    expect(two.done!.replayed).toBe(false);
    expect(one.done!.messageId).not.toBe(two.done!.messageId);
  });

  it("12. sessiz mod ses üretmez; kullanım ölçümü: oturum, dakika, kesinti, yeniden deneme, yedek, hata oranı", async () => {
    const proof = await proofFor(A.t1);
    const muted = await live(A.t1, proof, { say: "Ayran var mı?", muted: true });
    expect(muted.of("audio")).toHaveLength(0);
    expect(muted.done!.metrics.firstAudioMs).toBeNull();
    const v = await voiceRange({ tenantId: A.tenantId, createdAt: { gte: new Date(Date.now() - 3600_000) } });
    expect(v.sessions).toBeGreaterThanOrEqual(8);
    expect(v.fallbackTurns).toBe(1);
    expect(v.interruptions).toBeGreaterThanOrEqual(3);
    expect(v.reconnects).toBeGreaterThanOrEqual(2);
    expect(v.audioInSeconds).toBeGreaterThan(0);
    expect(v.audioOutSeconds).toBeGreaterThan(0);
    expect(v.fallbackRate).toBeGreaterThan(0);
    expect(v.avgFirstAudioMs).not.toBeNull();
    // Başka kiracının ölçümüne karışmaz
    expect((await voiceRange({ tenantId: P.tenantId, createdAt: { gte: new Date(0) } })).turns).toBe(0);
  });
});
