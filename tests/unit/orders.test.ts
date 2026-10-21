import { describe, expect, it } from "vitest";
import { calculateLine, calculateOrder, defaultVariantRef, ORDER_LIMITS, type CatalogProduct, type ItemSelection } from "@/lib/orders/calculate";
import { addLine, cartItemCount, cartLineKey, emptyCart, parseStoredCart, replaceLine, setQuantity, toSelections, CART_TTL_MS, type Cart } from "@/lib/orders/cart";
import { hashIdempotencyKey, hashOrderRequest, newPublicOrderId } from "@/lib/orders/idempotency";
import { sanitizeNote } from "@/lib/orders/notes";
import { ORDER_TRANSITIONS, canStaffTransition, canTransitionOrderStatus, formatOrderNumber } from "@/lib/orders/status";
import { textDirection } from "@/config/menu";
import { orderStrings } from "@/lib/public-menu/i18n-order";
import { submitOrderSchema } from "@/lib/validation/orders";
import { reconcileLines } from "@/server/services/orders/submit-order.service";

// ─── Katalog fikstürü (fiyatlar ZATEN merkezi çözümleyiciden geçmiş kabul edilir) ─────────

const burger: CatalogProduct = {
  key: "cheeseburger",
  name: "Cheeseburger",
  currency: "TRY",
  availability: "available",
  basePriceMinor: 38000,
  variants: [
    { ref: "v-tek", name: "Tek", priceMinor: 38000, isDefault: true },
    { ref: "v-cift", name: "Çift", priceMinor: 50000, isDefault: false },
  ],
  groups: [
    { ref: "g-pisirme", name: "Pişirme", required: true, minSelect: 1, maxSelect: 1, modifiers: [{ ref: "m-az", name: "Az", priceDeltaMinor: 0 }, { ref: "m-orta", name: "Orta", priceDeltaMinor: 0 }] },
    {
      ref: "g-ekstra",
      name: "Ekstra",
      required: false,
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { ref: "m-cheddar", name: "Cheddar", priceDeltaMinor: 3000 },
        { ref: "m-fume", name: "Füme", priceDeltaMinor: 5000 },
        { ref: "m-jalapeno", name: "Jalapeno", priceDeltaMinor: 2000 },
      ],
    },
  ],
};
const soup: CatalogProduct = { key: "corba", name: "Çorba", currency: "TRY", availability: "available", basePriceMinor: 12000, variants: [], groups: [] };
const catalog = new Map([
  [burger.key, burger],
  [soup.key, soup],
]);
const sel = (overrides: Partial<ItemSelection> = {}): ItemSelection => ({
  product: "cheeseburger",
  variant: "v-cift",
  modifiers: [
    { group: "g-pisirme", modifier: "m-orta" },
    { group: "g-ekstra", modifier: "m-cheddar" },
  ],
  quantity: 2,
  note: null,
  ...overrides,
});

describe("merkezi sipariş hesaplayıcı", () => {
  it("varyant fiyatı + ekstra farkları × adet (tamsayı kuruş)", () => {
    const line = calculateLine(burger, sel());
    expect(line).toMatchObject({ basePriceMinor: 50000, modifiersTotalMinor: 3000, unitPriceMinor: 53000, lineTotalMinor: 106000, issues: [] });
    expect(line.variant?.name).toBe("Çift");
    expect(line.modifiers.map((m) => m.modifier.name)).toEqual(["Orta", "Cheddar"]);
  });

  it("varyantsız ürün: çözülmüş taban fiyat; sipariş toplamı ve adet", () => {
    const calc = calculateOrder(catalog, [sel(), { product: "corba", variant: null, modifiers: [], quantity: 3, note: null }]);
    expect(calc).toMatchObject({ ok: true, subtotalMinor: 106000 + 36000, totalMinor: 142000, itemCount: 5, currency: "TRY" });
  });

  it("ekstra kuralları: zorunlu eksik, en fazla aşımı, tekrar, başka grubun ekstrası, ürüne bağlı olmayan grup", () => {
    const codes = (s: ItemSelection) => calculateLine(burger, s).issues.map((i) => i.code);
    expect(codes(sel({ modifiers: [] }))).toEqual(["group_min"]);
    expect(codes(sel({ modifiers: [{ group: "g-pisirme", modifier: "m-orta" }, { group: "g-ekstra", modifier: "m-cheddar" }, { group: "g-ekstra", modifier: "m-fume" }, { group: "g-ekstra", modifier: "m-jalapeno" }] }))).toEqual(["group_max"]);
    expect(codes(sel({ modifiers: [{ group: "g-pisirme", modifier: "m-orta" }, { group: "g-pisirme", modifier: "m-orta" }] }))).toEqual(["duplicate_modifier"]);
    expect(codes(sel({ modifiers: [{ group: "g-pisirme", modifier: "m-cheddar" }] }))).toEqual(["modifier_invalid", "group_min"]);
    expect(codes(sel({ modifiers: [{ group: "g-baska-urun", modifier: "m-x" }, { group: "g-pisirme", modifier: "m-az" }] }))).toEqual(["group_invalid"]);
    expect(codes(sel({ modifiers: [{ group: "g-pisirme", modifier: "m-az" }, { group: "g-pisirme", modifier: "m-orta" }] }))).toEqual(["group_max"]);
  });

  it("varyant: varyantlı üründe zorunlu (sunucu varsayılanı kendisi seçmez); varyantsız üründe varyant geçersiz", () => {
    expect(calculateLine(burger, sel({ variant: null })).issues.map((i) => i.code)).toContain("variant_required");
    expect(calculateLine(burger, sel({ variant: "v-yok" })).issues.map((i) => i.code)).toContain("variant_invalid");
    expect(calculateLine(soup, { product: "corba", variant: "v-tek", modifiers: [], quantity: 1, note: null }).issues.map((i) => i.code)).toEqual(["variant_invalid"]);
    expect(defaultVariantRef(burger)).toBe("v-tek");
    expect(defaultVariantRef(soup)).toBeNull();
  });

  it("kullanılabilirlik ve adet sınırları", () => {
    expect(calculateLine({ ...burger, availability: "sold_out" }, sel()).issues.map((i) => i.code)).toEqual(["sold_out"]);
    expect(calculateLine(undefined, sel()).issues.map((i) => i.code)).toEqual(["product_unavailable"]);
    expect(calculateLine({ ...burger, availability: "unavailable" }, sel()).issues.map((i) => i.code)).toEqual(["product_unavailable"]);
    for (const q of [0, -1, 1.5, ORDER_LIMITS.maxQuantityPerLine + 1]) expect(calculateLine(burger, sel({ quantity: q })).issues.map((i) => i.code)).toContain("quantity_invalid");
    expect(calculateOrder(catalog, []).orderIssues).toEqual(["empty"]);
    expect(calculateOrder(catalog, Array.from({ length: ORDER_LIMITS.maxLines + 1 }, () => ({ product: "corba", variant: null, modifiers: [], quantity: 1, note: null }))).orderIssues).toContain("too_many_lines");
    expect(calculateOrder(catalog, Array.from({ length: 6 }, () => ({ product: "corba", variant: null, modifiers: [], quantity: 20, note: null }))).orderIssues).toContain("too_many_items");
  });

  it("karışık para birimi reddedilir", () => {
    const usd = new Map([...catalog, ["latte", { ...soup, key: "latte", currency: "USD" }]]);
    expect(calculateOrder(usd, [{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null }, { product: "latte", variant: null, modifiers: [], quantity: 1, note: null }]).orderIssues).toContain("mixed_currency");
  });

  it("istemcinin gördüğü fiyat yalnızca karşılaştırılır: farklıysa price_changed (toplam sessizce değişmez)", () => {
    const changed = calculateOrder(catalog, [sel({ expectedUnitPriceMinor: 1 })], { checkExpectedPrice: true });
    expect(changed.ok).toBe(false);
    expect(changed.lines[0]!.issues).toEqual([{ code: "price_changed", fromMinor: 1, toMinor: 53000 }]);
    expect(changed.lines[0]!.unitPriceMinor).toBe(53000);
    expect(calculateOrder(catalog, [sel({ expectedUnitPriceMinor: 53000 })], { checkExpectedPrice: true }).ok).toBe(true);
    expect(calculateOrder(catalog, [sel({ expectedUnitPriceMinor: 1 })]).ok).toBe(true); // önizleme modu
  });

  it("mutabakat özeti: satır başına durum", () => {
    const calc = calculateOrder(
      new Map([...catalog, ["tukenen", { ...soup, key: "tukenen", availability: "sold_out" as const }]]),
      [sel({ expectedUnitPriceMinor: 40000 }), { product: "tukenen", variant: null, modifiers: [], quantity: 1, note: null }, { product: "yok", variant: null, modifiers: [], quantity: 1, note: null }, sel({ modifiers: [] })],
      { checkExpectedPrice: true },
    );
    expect(reconcileLines(calc).map((l) => [l.status, l.fromMinor, l.toMinor])).toEqual([
      ["price_changed", 40000, 53000],
      ["sold_out", undefined, undefined],
      ["unavailable", undefined, undefined],
      ["invalid", undefined, undefined],
    ]);
  });
});

// ─── Sepet ──────────────────────────────────────────────────────────────────

const meta = { scope: "scopeA", restaurant: "Demo", table: "Masa 12", returnPath: "/t/AbCdEfGhIjKlMnOpQrStUv" };
const line = (overrides: Partial<Parameters<typeof addLine>[1]> = {}) => ({
  product: "cheeseburger",
  variant: "v-cift",
  modifiers: [
    { group: "g-pisirme", modifier: "m-orta" },
    { group: "g-ekstra", modifier: "m-cheddar" },
  ],
  quantity: 1,
  note: null,
  unitPriceMinor: 53000,
  name: "Cheeseburger",
  detail: "Çift · Orta · Cheddar",
  ...overrides,
});

describe("sepet satır kimliği ve düzenleme", () => {
  it("aynı yapılandırma (ekstra sırası farklı olsa da) tek satırda birleşir; farklı ekstra / not ayrı satır", () => {
    let cart = addLine(emptyCart(meta), line());
    cart = addLine(cart, line({ modifiers: [...line().modifiers].reverse(), quantity: 2 }));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.quantity).toBe(3);
    cart = addLine(cart, line({ note: "Soğan olmasın" }));
    cart = addLine(cart, line({ modifiers: [{ group: "g-pisirme", modifier: "m-az" }] }));
    expect(cart.lines).toHaveLength(3);
    expect(cartItemCount(cart)).toBe(5);
    expect(cartLineKey({ ...line(), note: "  SOĞAN  " })).toBe(cartLineKey({ ...line(), note: "soğan" }));
  });

  it("adet sınırı, adet 0 → satır silinir, düzenleme sırayı korur", () => {
    let cart = addLine(emptyCart(meta), line({ quantity: 50 }));
    expect(cart.lines[0]!.quantity).toBe(ORDER_LIMITS.maxQuantityPerLine);
    cart = addLine(cart, line({ product: "corba", variant: null, modifiers: [], unitPriceMinor: 12000, name: "Çorba", detail: "" }));
    const firstKey = cart.lines[0]!.key;
    cart = replaceLine(cart, firstKey, line({ variant: "v-tek", unitPriceMinor: 41000 }));
    expect(cart.lines.map((l) => l.product)).toEqual(["cheeseburger", "corba"]);
    expect(cart.lines[0]!.variant).toBe("v-tek");
    cart = setQuantity(cart, cart.lines[1]!.key, 0);
    expect(cart.lines).toHaveLength(1);
  });

  it("sunucuya giden seçimde fiyat yalnızca 'beklenen' olarak gider; kimlik / toplam yok", () => {
    const cart = addLine(emptyCart(meta), line());
    const [s] = toSelections(cart);
    expect(Object.keys(s!).sort()).toEqual(["expectedUnitPriceMinor", "modifiers", "note", "product", "quantity", "variant"]);
  });

  it("depodan okunan sepet güvenilmez: bozuk / süresi dolmuş / kurcalanmış veri reddedilir, anahtar yeniden hesaplanır", () => {
    const cart: Cart = addLine(emptyCart(meta), line());
    const raw = JSON.stringify({ ...cart, lines: cart.lines.map((l) => ({ ...l, key: "sahte" })) });
    expect(parseStoredCart(raw)!.lines[0]!.key).toBe(cartLineKey(cart.lines[0]!));
    expect(parseStoredCart("{bozuk")).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cart, updatedAt: Date.now() - CART_TTL_MS - 1 }))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cart, returnPath: "https://evil.example/t/x" }))).toBeNull();
    expect(parseStoredCart(JSON.stringify({ ...cart, lines: [{ ...cart.lines[0], quantity: 999 }] }))).toBeNull();
  });
});

// ─── Durum, tekrar koruması, numara, notlar, şema, dil ──────────────────────

describe("sipariş durum makinesi", () => {
  it("merkezi geçiş tablosu; Sprint 6'da personel yalnızca kabul / ret", () => {
    expect(canTransitionOrderStatus("SUBMITTED", "ACCEPTED")).toBe(true);
    expect(canTransitionOrderStatus("SUBMITTED", "SERVED")).toBe(false);
    expect(canTransitionOrderStatus("REJECTED", "ACCEPTED")).toBe(false);
    expect(canStaffTransition("SUBMITTED", "ACCEPTED")).toBe(true);
    expect(canStaffTransition("SUBMITTED", "REJECTED")).toBe(true);
    expect(canStaffTransition("ACCEPTED", "PREPARING")).toBe(false); // Sprint 7
    expect(canStaffTransition("ACCEPTED", "REJECTED")).toBe(false);
    for (const terminal of ["SERVED", "CANCELLED", "REJECTED"] as const) expect(ORDER_TRANSITIONS[terminal]).toEqual([]);
    expect(formatOrderNumber(1042)).toBe("#1042");
  });
});

describe("tekrarlanan gönderim koruması", () => {
  const base = { tableId: "t1", items: [sel()], note: "birlikte" };
  it("aynı içerik → aynı özet (ekstra sırası önemsiz, beklenen fiyat hariç); farklı içerik / masa → farklı", () => {
    const h = hashOrderRequest(base);
    expect(hashOrderRequest({ ...base, items: [sel({ modifiers: [...sel().modifiers].reverse(), expectedUnitPriceMinor: 1 })] })).toBe(h);
    expect(hashOrderRequest({ ...base, items: [sel({ quantity: 3 })] })).not.toBe(h);
    expect(hashOrderRequest({ ...base, tableId: "t2" })).not.toBe(h);
    expect(hashOrderRequest({ ...base, note: null })).not.toBe(h);
  });
  it("anahtar özeti anahtarı içermez; public kimlik 128 bit ve benzersiz", () => {
    const key = "AbCdEfGhIjKlMnOpQrStUvWx";
    expect(hashIdempotencyKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdempotencyKey(key)).not.toContain(key);
    const ids = new Set(Array.from({ length: 300 }, newPublicOrderId));
    expect(ids.size).toBe(300);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("notlar ve girdi şeması", () => {
  it("not düz metin: kontrol / yön işaretleri atılır, sınırlanır; HTML olduğu gibi metin kalır (yorumlanmaz)", () => {
    expect(sanitizeNote("  Soğan\u0000 olmasın‮  ", 140)).toBe("Soğan olmasın");
    expect(sanitizeNote("<b>x</b>", 140)).toBe("<b>x</b>");
    expect(sanitizeNote("a".repeat(500), 140)).toHaveLength(140);
    expect(sanitizeNote("   ", 140)).toBeNull();
  });
  it("istemcinin gönderdiği fiyat / toplam / kiracı / masa alanları şemada atılır", () => {
    const parsed = submitOrderSchema.parse({
      items: [{ ...sel(), price: 1, unitPriceMinor: 1, tenantId: "x" }],
      note: null,
      idempotencyKey: "AbCdEfGhIjKlMnOpQrStUv",
      locale: "tr",
      totalMinor: 1,
      tableId: "t-baska",
      branchId: "b",
    });
    expect(parsed).not.toHaveProperty("totalMinor");
    expect(parsed).not.toHaveProperty("tableId");
    expect(parsed.items[0]).not.toHaveProperty("price");
    expect(parsed.items[0]).not.toHaveProperty("tenantId");
    expect(submitOrderSchema.safeParse({ items: [], note: null, idempotencyKey: "AbCdEfGhIjKlMnOpQrStUv", locale: "tr" }).success).toBe(false);
    expect(submitOrderSchema.safeParse({ items: [sel({ quantity: 999 })], note: null, idempotencyKey: "AbCdEfGhIjKlMnOpQrStUv", locale: "tr" }).success).toBe(false);
    expect(submitOrderSchema.safeParse({ items: [sel()], note: null, idempotencyKey: "kısa", locale: "tr" }).success).toBe(false);
  });
});

describe("sepet / sipariş dili ve RTL", () => {
  it("dört dilde tüm metinler dolu; Arapça RTL", () => {
    for (const locale of ["tr", "en", "de", "ar"]) {
      const o = orderStrings(locale);
      for (const [key, value] of Object.entries(o)) {
        if (typeof value === "string") expect(value.trim(), `${locale}.${key}`).not.toBe("");
        if (typeof value === "function") expect(String(Reflect.apply(value, undefined, ["1", "2"])).trim(), `${locale}.${key}`).not.toBe("");
      }
      expect(Object.values(o.status).every((s) => s.trim() !== "")).toBe(true);
    }
    expect(orderStrings("ar").sendOrder).toBe("إرسال الطلب");
    expect(orderStrings("xx").sendOrder).toBe("Siparişi Gönder");
    expect(textDirection("ar")).toBe("rtl");
  });
});
