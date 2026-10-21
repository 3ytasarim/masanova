import { describe, expect, it } from "vitest";
import { allocateProportionally, linePayables, splitEqually, unitsAmount } from "@/lib/payments/allocation";
import { canTransitionPayment, isActiveReservation, isPayableOrderStatus, paymentSummary, refundableMinor, signWebhook, statusAfterRefund, verifyWebhookSignature, type PaymentLike } from "@/lib/payments/state";
import { AI_TOOL_NAMES } from "@/lib/ai/tools";
import { REDACTED, redact } from "@/lib/observability/redact";
import { createMockProvider, mockQueue, mockReset } from "@/server/payments/providers/mock";

/** Sprint 19 — ödeme matematiği, durum makinesi, webhook imzası, test sağlayıcısı (saf / bellek içi). */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("eşit bölme (yuvarlama kuruşu kuruşuna)", () => {
  it.each([
    [10_001, 3, [3334, 3334, 3333]],
    [10_000, 3, [3334, 3333, 3333]],
    [100, 7, [15, 15, 14, 14, 14, 14, 14]],
    [5, 1, [5]],
    [0, 2, [0, 0]],
  ])("%i / %i", (total, parts, expected) => {
    expect(splitEqually(total, parts)).toEqual(expected);
    expect(sum(splitEqually(total, parts))).toBe(total);
  });
  it("geçersiz girdi → boş", () => {
    expect(splitEqually(100, 0)).toEqual([]);
    expect(splitEqually(-1, 2)).toEqual([]);
    expect(splitEqually(10.5, 2)).toEqual([]);
  });
  it("rastgele: toplam her zaman korunur, paylar en fazla 1 kuruş farklı", () => {
    for (let i = 0; i < 500; i++) {
      const total = Math.floor(Math.random() * 1_000_000);
      const parts = 1 + Math.floor(Math.random() * 20);
      const s = splitEqually(total, parts);
      expect(sum(s)).toBe(total);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    }
  });
});

describe("orantılı indirim dağıtımı (en büyük kalan, deterministik)", () => {
  it("toplam tam korunur", () => {
    expect(allocateProportionally([1000, 2000, 3000], 1000)).toEqual([167, 333, 500]);
    expect(sum(allocateProportionally([333, 333, 334], 100))).toBe(100);
  });
  it("eşit kesirlerde düşük indeks önce", () => {
    expect(allocateProportionally([1, 1, 1], 2)).toEqual([1, 1, 0]);
  });
  it("sıfır ağırlık / toplam", () => {
    expect(allocateProportionally([0, 0], 100)).toEqual([0, 0]);
    expect(allocateProportionally([10, 20], 0)).toEqual([0, 0]);
  });
  it("rastgele: Σ = indirim ve her pay ≤ kalem", () => {
    for (let i = 0; i < 300; i++) {
      const w = Array.from({ length: 1 + Math.floor(Math.random() * 8) }, () => Math.floor(Math.random() * 50_000));
      const total = Math.floor(Math.random() * sum(w));
      const a = allocateProportionally(w, total);
      if (sum(w) > 0 && total > 0) expect(sum(a)).toBe(total);
      a.forEach((x, j) => expect(x).toBeLessThanOrEqual(w[j]! + 1));
    }
  });
});

describe("kalem bazında ödenecek tutar (değişmez kopyalardan)", () => {
  const lines = [
    { id: "a", name: "Burger", quantity: 2, unitPriceMinor: 30_000, lineTotalMinor: 60_000 },
    { id: "b", name: "Kola", quantity: 3, unitPriceMinor: 5_000, lineTotalMinor: 15_000 },
    { id: "c", name: "Tatlı", quantity: 1, unitPriceMinor: 10_001, lineTotalMinor: 10_001 },
  ];
  const total = 85_001;
  it("indirimsiz: kalem = kalem tutarı; Σ birim = kalem", () => {
    const p = linePayables(lines, null);
    expect(p.map((l) => l.payableMinor)).toEqual([60_000, 15_000, 10_001]);
    p.forEach((l) => expect(sum(l.unitPayables)).toBe(l.payableMinor));
  });
  it("sabit indirim orantılı dağıtılır; Σ kalem = sipariş toplamı", () => {
    const p = linePayables(lines, { promotionType: "FIXED_AMOUNT", discountMinor: 10_000, freeItemName: null });
    expect(sum(p.map((l) => l.payableMinor))).toBe(total - 10_000);
    p.forEach((l) => expect(sum(l.unitPayables)).toBe(l.payableMinor));
  });
  it("yüzde indirim de aynı kural", () => {
    const p = linePayables(lines, { promotionType: "PERCENTAGE", discountMinor: 8_500, freeItemName: null });
    expect(sum(p.map((l) => l.payableMinor))).toBe(total - 8_500);
  });
  it("ücretsiz ürün: indirim o kalemin İLK birimine; ödeyen 0 öder", () => {
    const p = linePayables(lines, { promotionType: "FREE_ITEM", discountMinor: 5_000, freeItemName: "Kola" });
    const kola = p.find((l) => l.id === "b")!;
    expect(kola.unitPayables).toEqual([0, 5_000, 5_000]);
    expect(p.find((l) => l.id === "a")!.payableMinor).toBe(60_000);
    expect(sum(p.map((l) => l.payableMinor))).toBe(total - 5_000);
    expect(unitsAmount(kola, 0, 1)).toBe(0);
    expect(unitsAmount(kola, 1, 2)).toBe(10_000);
  });
  it("ücretsiz ürün eşleşmezse orantılıya düşer", () => {
    const p = linePayables(lines, { promotionType: "FREE_ITEM", discountMinor: 4_000, freeItemName: "Yok" });
    expect(sum(p.map((l) => l.payableMinor))).toBe(total - 4_000);
  });
  it("birimler sırayla ödenir (deterministik)", () => {
    const t = linePayables([lines[2]!], null)[0]!;
    expect(unitsAmount(t, 0, 1)).toBe(10_001);
    const odd = linePayables([{ id: "x", name: "X", quantity: 3, unitPriceMinor: 3_334, lineTotalMinor: 10_001 }], { promotionType: "FIXED_AMOUNT", discountMinor: 1, freeItemName: null })[0]!;
    expect(odd.unitPayables).toEqual([3334, 3333, 3333]);
    expect(unitsAmount(odd, 0, 1) + unitsAmount(odd, 1, 2)).toBe(10_000);
  });
});

describe("bakiye / rezervasyon / iade politikası", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const later = new Date(now.getTime() + 15 * 60_000);
  const earlier = new Date(now.getTime() - 1);
  const pay = (status: PaymentLike["status"], amountMinor: number, extra: Partial<PaymentLike> = {}): PaymentLike => ({ status, amountMinor, refundedMinor: 0, reservedUntil: null, ...extra });
  it("ödenmemiş / kısmi / tam", () => {
    expect(paymentSummary(50_000, [], now)).toMatchObject({ paid: 0, remaining: 50_000, available: 50_000, state: "UNPAID" });
    expect(paymentSummary(50_000, [pay("SUCCEEDED", 20_000)], now)).toMatchObject({ paid: 20_000, remaining: 30_000, state: "PARTIALLY_PAID" });
    expect(paymentSummary(50_000, [pay("SUCCEEDED", 20_000), pay("SUCCEEDED", 30_000)], now)).toMatchObject({ remaining: 0, available: 0, state: "PAID" });
  });
  it("etkin rezervasyon kullanılabilir tutarı düşürür; süresi dolan düşürmez", () => {
    expect(paymentSummary(50_000, [pay("PENDING", 50_000, { reservedUntil: later })], now)).toMatchObject({ remaining: 50_000, reserved: 50_000, available: 0 });
    expect(paymentSummary(50_000, [pay("PROCESSING", 50_000, { reservedUntil: earlier })], now)).toMatchObject({ reserved: 0, available: 50_000 });
    expect(isActiveReservation(pay("FAILED", 1, { reservedUntil: later }), now)).toBe(false);
  });
  it("başarısız / iptal ödeme bakiyeyi etkilemez", () => {
    expect(paymentSummary(10_000, [pay("FAILED", 10_000), pay("CANCELLED", 10_000)], now)).toMatchObject({ paid: 0, available: 10_000 });
  });
  it("iade bakiyeyi yeniden açmaz; durum kısmi iade / iade", () => {
    expect(paymentSummary(10_000, [pay("PARTIALLY_REFUNDED", 10_000, { refundedMinor: 3_000 })], now)).toMatchObject({ paid: 10_000, refunded: 3_000, remaining: 0, state: "PARTIALLY_REFUNDED" });
    expect(paymentSummary(10_000, [pay("REFUNDED", 10_000, { refundedMinor: 10_000 })], now)).toMatchObject({ remaining: 0, state: "REFUNDED" });
  });
  it("iade sınırı ve durum", () => {
    expect(refundableMinor({ status: "SUCCEEDED", amountMinor: 10_000, refundedMinor: 2_500 })).toBe(7_500);
    expect(refundableMinor({ status: "FAILED", amountMinor: 10_000, refundedMinor: 0 })).toBe(0);
    expect(refundableMinor({ status: "REFUNDED", amountMinor: 10_000, refundedMinor: 10_000 })).toBe(0);
    expect(statusAfterRefund(10_000, 0)).toBe("SUCCEEDED");
    expect(statusAfterRefund(10_000, 1)).toBe("PARTIALLY_REFUNDED");
    expect(statusAfterRefund(10_000, 10_000)).toBe("REFUNDED");
  });
  it("ödenebilir sipariş durumları", () => {
    for (const s of ["ACCEPTED", "PREPARING", "READY", "SERVED"]) expect(isPayableOrderStatus(s)).toBe(true);
    for (const s of ["SUBMITTED", "REJECTED", "CANCELLED"]) expect(isPayableOrderStatus(s)).toBe(false);
  });
});

describe("durum makinesi", () => {
  it("geçerli geçişler", () => {
    expect(canTransitionPayment("PENDING", "PROCESSING")).toBe(true);
    expect(canTransitionPayment("PROCESSING", "SUCCEEDED")).toBe(true);
    expect(canTransitionPayment("PENDING", "FAILED")).toBe(true);
    expect(canTransitionPayment("SUCCEEDED", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canTransitionPayment("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
  });
  it("kesinleşen ödeme geri dönmez (geç gelen 'failed' webhook başarıyı bozamaz)", () => {
    for (const to of ["PENDING", "PROCESSING", "FAILED", "CANCELLED"] as const) expect(canTransitionPayment("SUCCEEDED", to)).toBe(false);
    expect(canTransitionPayment("REFUNDED", "SUCCEEDED")).toBe(false);
    expect(canTransitionPayment("FAILED", "PENDING")).toBe(false);
  });
});

describe("webhook imzası (HMAC, zaman toleransı, sabit zamanlı karşılaştırma)", () => {
  const secret = "test-secret-0123456789";
  const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", reference: "mock_x" });
  it("doğru imza kabul", () => {
    const now = Date.now();
    expect(verifyWebhookSignature(secret, signWebhook(secret, now, body), body, now)).toBe(true);
  });
  it("yanlış gizli anahtar / değişmiş gövde / eksik başlık reddedilir", () => {
    const now = Date.now();
    expect(verifyWebhookSignature(secret, signWebhook("other-secret-xxxxxxxx", now, body), body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, signWebhook(secret, now, body), body.replace("succeeded", "failed"), now)).toBe(false);
    expect(verifyWebhookSignature(secret, null, body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, "garbage", body, now)).toBe(false);
  });
  it("eski zaman damgası (tekrar oynatma) reddedilir", () => {
    const now = Date.now();
    expect(verifyWebhookSignature(secret, signWebhook(secret, now - 6 * 60_000, body), body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, signWebhook(secret, now + 6 * 60_000, body), body, now)).toBe(false);
  });
});

describe("test sağlayıcısı (mock)", () => {
  const secret = "mock-secret-0123456789";
  const input = (key: string) => ({ reference: "pay_1", amountMinor: 1000, currency: "TRY", idempotencyKey: key, returnUrl: "/t/x/siparis/y/odeme", description: "test" });
  it("sağlayıcı idempotency: aynı anahtar → aynı referans", async () => {
    mockReset();
    const p = createMockProvider(secret);
    const a = await p.createPayment(input("k1"));
    const b = await p.createPayment(input("k1"));
    expect(a.providerReference).toBe(b.providerReference);
    expect(a.checkoutUrl).toMatch(/^\/odeme\/mock\/mock_[0-9a-f]{24}\?r=/);
  });
  it("SUCCESS / FAIL / PENDING / TIMEOUT", async () => {
    mockReset();
    const p = createMockProvider(secret);
    mockQueue("SUCCESS", "FAIL", "PENDING", "TIMEOUT");
    expect((await p.createPayment(input("s"))).status).toBe("SUCCEEDED");
    expect((await p.createPayment(input("f"))).status).toBe("FAILED");
    const pending = await p.createPayment(input("p"));
    expect(pending.status).toBe("PENDING");
    expect(pending.checkoutUrl).toBeNull();
    await expect(p.createPayment(input("t"))).rejects.toThrow();
  });
  it("olay imzalı, ayrıştırılabilir; kart verisi yalnızca marka + son 4", async () => {
    mockReset();
    const p = createMockProvider(secret);
    const r = await p.createPayment(input("e"));
    const e = p.buildEvent(r.providerReference, "payment.succeeded", "evt_fixed");
    const h = new Headers({ "x-masanova-signature": e.signature });
    expect(p.verifyWebhook(e.rawBody, h)).toBe(true);
    expect(p.parseWebhook(e.rawBody)).toEqual({ eventId: "evt_fixed", type: "payment.succeeded", providerReference: r.providerReference, card: { brand: "TEST", last4: "4242" } });
    expect((await p.getPayment(r.providerReference)).status).toBe("SUCCEEDED");
    const flipped = e.signature.slice(0, -1) + (e.signature.endsWith("0") ? "1" : "0");
    expect(p.verifyWebhook(e.rawBody, new Headers({ "x-masanova-signature": flipped }))).toBe(false);
  });
  it("iade: kesinleşmemiş ödemede / tutar aşımında reddedilir", async () => {
    mockReset();
    const p = createMockProvider(secret);
    mockQueue("SUCCESS");
    const r = await p.createPayment(input("r"));
    expect((await p.refundPayment({ providerReference: r.providerReference, amountMinor: 1001, idempotencyKey: "x" })).ok).toBe(false);
    expect((await p.refundPayment({ providerReference: r.providerReference, amountMinor: 400, idempotencyKey: "y" })).ok).toBe(true);
    expect((await p.refundPayment({ providerReference: r.providerReference, amountMinor: 601, idempotencyKey: "z" })).ok).toBe(false);
  });
});

describe("güvenlik sınırları", () => {
  it("sesli / metin AI asistanında ödeme aracı YOK", () => {
    for (const name of AI_TOOL_NAMES) expect(name).not.toMatch(/pay|charge|refund|checkout|card|odeme|ödeme/i);
  });
  it("log redaksiyonu: imza / kart / cvv / ödeme bağlantısı / webhook gizli anahtarı", () => {
    const out = redact({ signature: "t=1,v1=abc", cardNumber: "4242424242424242", cvv: "123", checkoutUrl: "/odeme/mock/x", webhookSecret: "s", amountMinor: 100 }) as Record<string, unknown>;
    expect(out.amountMinor).toBe(100);
    for (const k of ["signature", "cardNumber", "cvv", "checkoutUrl", "webhookSecret"]) expect(out[k]).toBe(REDACTED);
  });
});
