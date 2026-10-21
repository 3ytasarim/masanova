import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const svc = await import("@/server/services/ai/voice-index.service");
const { matchProduct } = await import("@/lib/ai/voice-lexicon");

/**
 * Sesli menü dizini — gerçek PostgreSQL (Neon). İki geçici kiracı (farklı menüler): kurulum, kiracı yalıtımı, menü
 * değişince eskimiş işareti, yeniden kurulum, menüden çıkan ürünün söyleyişlerinin atılması. Sonunda silinir.
 */
const run = randomBytes(3).toString("hex");
const ids: string[] = [];

async function makeTenant(label: string, products: { slug: string; name: string; category: string; price: number }[]) {
  const t = await prisma.tenant.create({
    data: { name: `Ses ${label} ${run}`, slug: `ses-${label}-${run}`, status: "ACTIVE", subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } }, settings: { create: { defaultLocale: "tr" } }, branches: { create: [{ name: "Merkez", slug: "merkez" }] } },
  });
  ids.push(t.id);
  const cats = new Map<string, string>();
  for (const [i, p] of products.entries()) {
    if (!cats.has(p.category)) {
      const c = await prisma.menuCategory.create({ data: { tenantId: t.id, slug: `kat-${cats.size}`, name: p.category, sortOrder: cats.size * 10 } });
      cats.set(p.category, c.id);
    }
    await prisma.product.create({ data: { tenantId: t.id, slug: p.slug, name: p.name, categoryId: cats.get(p.category)!, basePriceMinor: p.price, currency: "TRY", sortOrder: i * 10, allergensConfirmedAt: new Date() } });
  }
  return createTenantScope(t.id);
}

let A: ReturnType<typeof createTenantScope>;
let B: ReturnType<typeof createTenantScope>;

beforeAll(async () => {
  A = await makeTenant("a", [
    { slug: "fettuccine-alfredo", name: "Fettuccine Alfredo", category: "Makarnalar", price: 42000 },
    { slug: "cokertme-kebabi", name: "Çökertme Kebabı", category: "Kebaplar", price: 52000 },
    { slug: "ayran", name: "Ayran", category: "İçecekler", price: 6000 },
  ]);
  B = await makeTenant("b", [
    { slug: "mercimek-corbasi", name: "Mercimek Çorbası", category: "Çorbalar", price: 17500 },
    { slug: "ayran", name: "Ayran", category: "İçecekler", price: 6500 },
  ]);
}, 60_000);

afterAll(async () => {
  await prisma.voiceMenuIndex.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.menuCategory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}, 60_000);

describe("sesli menü dizini (Neon)", () => {
  it("menüyü tarar: READY + istatistik; yalnızca kiracının kendi ürünleri", async () => {
    const view = await svc.buildVoiceIndex(A, { useAi: false });
    expect(view.status).toBe("READY");
    expect(view.counts.products).toBe(3);
    expect(view.counts.terms).toBeGreaterThan(3);
    const row = await prisma.voiceMenuIndex.findUniqueOrThrow({ where: { tenantId: A.tenantId } });
    const names = ((row.lexicon as { entries: { name: string }[] }).entries ?? []).map((e) => e.name).sort();
    expect(names).toEqual(["Ayran", "Fettuccine Alfredo", "Çökertme Kebabı"].sort());
  }, 60_000);

  it("kiracı yalıtımı: A'nın ürünü B'de eşleşmez (uydurma yok)", async () => {
    await svc.buildVoiceIndex(B, { useAi: false });
    const lexA = await svc.runtimeLexicon(A.tenantId, await svc.loadIndexProducts(A));
    const lexB = await svc.runtimeLexicon(B.tenantId, await svc.loadIndexProducts(B));
    expect(matchProduct(lexA, "fetuçini alfredo")).toMatchObject({ status: "high", product: { name: "Fettuccine Alfredo" } });
    expect(matchProduct(lexB, "fetuçini alfredo").status).toBe("none");
    expect(matchProduct(lexB, "mercimek çorbası")).toMatchObject({ status: "high", product: { name: "Mercimek Çorbası" } });
    expect(matchProduct(lexA, "mercimek çorbası").status).toBe("none");
    expect(lexB.entries.some((e) => e.name === "Çökertme Kebabı")).toBe(false);
  }, 60_000);

  it("menü değişince eskimiş işaretlenir; yeniden kurulumda yeni ad tanınır, eski ad tanınmaz", async () => {
    await prisma.product.updateMany({ where: { tenantId: A.tenantId, slug: "cokertme-kebabi" }, data: { name: "Beyti Kebabı" } });
    svc.scheduleVoiceIndexRefresh(A.tenantId);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await prisma.voiceMenuIndex.findUniqueOrThrow({ where: { tenantId: A.tenantId } })).status).toBe("STALE");
    expect((await svc.getVoiceIndexView(A)).status).toBe("STALE");
    // B etkilenmez.
    expect((await prisma.voiceMenuIndex.findUniqueOrThrow({ where: { tenantId: B.tenantId } })).status).toBe("READY");
    const rebuilt = await svc.buildVoiceIndex(A, { useAi: false });
    expect(rebuilt.status).toBe("READY");
    const lex = await svc.runtimeLexicon(A.tenantId, await svc.loadIndexProducts(A));
    expect(matchProduct(lex, "beyti kebabı")).toMatchObject({ status: "high", product: { name: "Beyti Kebabı" } });
    expect(matchProduct(lex, "çökertme").status).not.toBe("high");
  }, 60_000);

  it("menüden çıkan ürünün kayıtlı ek söyleyişleri atılır (başka ürüne taşınmaz)", async () => {
    await prisma.voiceMenuIndex.update({ where: { tenantId: A.tenantId }, data: { aiTerms: { "fettuccine-alfredo": ["fetuçini"], "silinen-urun": ["hayalet"] } } });
    await svc.buildVoiceIndex(A, { useAi: false });
    const row = await prisma.voiceMenuIndex.findUniqueOrThrow({ where: { tenantId: A.tenantId } });
    expect(Object.keys(row.aiTerms as Record<string, string[]>)).toEqual(["fettuccine-alfredo"]);
  }, 60_000);
});
