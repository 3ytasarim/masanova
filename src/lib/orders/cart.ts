import { z } from "zod";
import { ORDER_LIMITS, type ItemSelection } from "@/lib/orders/calculate";
import { sanitizeNote } from "@/lib/orders/notes";

/**
 * Müşteri sepeti — istemci tarafı durum (saf yardımcılar). Sepet YETKİ verisi değildir: masa / şube / kiracı
 * kimliği içermez; yalnızca sunucunun verdiği opak bir masa kapsamı (`scope`) ve görüntü ipuçları (ad) tutar.
 * Gönderimde masa bağlamı her zaman QR token'dan sunucuda yeniden kurulur; fiyatlar sunucuda yeniden hesaplanır.
 */

export type CartLine = {
  /** Satır kimliği: ürün + varyant + sıralı ekstralar + not → aynı yapılandırma tek satırda birleşir. */
  key: string;
  product: string;
  variant: string | null;
  modifiers: { group: string; modifier: string }[];
  quantity: number;
  note: string | null;
  /** Ekleme anında gösterilen birim fiyat (yalnızca karşılaştırma; sunucu yeniden hesaplar). */
  unitPriceMinor: number;
  /** Görüntü ipuçları (çevrimdışı/yenileme öncesi gösterim için). */
  name: string;
  detail: string;
};

export type Cart = {
  version: 1;
  /** Sunucunun verdiği opak masa kapsamı. */
  scope: string;
  restaurant: string;
  table: string;
  /** Bu masanın menü adresi (yalnızca "geri dön" bağlantısı; yetki değildir). */
  returnPath: string;
  lines: CartLine[];
  note: string;
  updatedAt: number;
};

/** Sepet bu süre dokunulmazsa düşer (masadan kalkan müşterinin sepeti bir sonrakine kalmasın). */
export const CART_TTL_MS = 6 * 60 * 60 * 1000;
export const CART_STORAGE_PREFIX = "mn_cart:";

export function normalizeModifiers(modifiers: readonly { group: string; modifier: string }[]): { group: string; modifier: string }[] {
  const unique = new Map<string, { group: string; modifier: string }>();
  for (const m of modifiers) unique.set(`${m.group}:${m.modifier}`, { group: m.group, modifier: m.modifier });
  return [...unique.values()].sort((a, b) => (a.group === b.group ? a.modifier.localeCompare(b.modifier) : a.group.localeCompare(b.group)));
}

export function cartLineKey(input: { product: string; variant: string | null; modifiers: readonly { group: string; modifier: string }[]; note: string | null }): string {
  const mods = normalizeModifiers(input.modifiers)
    .map((m) => `${m.group}.${m.modifier}`)
    .join(",");
  const note = (input.note ?? "").trim().toLocaleLowerCase("tr-TR");
  return `${input.product}|${input.variant ?? "-"}|${mods}|${note}`;
}

export function emptyCart(meta: { scope: string; restaurant: string; table: string; returnPath: string }): Cart {
  return { version: 1, ...meta, lines: [], note: "", updatedAt: Date.now() };
}

/** Satır ekler; aynı yapılandırma varsa adedi birleştirir (satır başı üst sınırla). */
export function addLine(cart: Cart, line: Omit<CartLine, "key">): Cart {
  const note = sanitizeNote(line.note, ORDER_LIMITS.itemNoteMax);
  const modifiers = normalizeModifiers(line.modifiers);
  const key = cartLineKey({ ...line, modifiers, note });
  const existing = cart.lines.find((l) => l.key === key);
  const lines = existing
    ? cart.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(ORDER_LIMITS.maxQuantityPerLine, l.quantity + line.quantity), unitPriceMinor: line.unitPriceMinor, name: line.name, detail: line.detail } : l))
    : [...cart.lines, { ...line, modifiers, note, key, quantity: Math.min(ORDER_LIMITS.maxQuantityPerLine, line.quantity) }];
  return { ...cart, lines: lines.slice(0, ORDER_LIMITS.maxLines), updatedAt: Date.now() };
}

/** Bir satırı yeni yapılandırmayla değiştirir (düzenleme). Yeni anahtar başka satırla çakışırsa birleşir. */
export function replaceLine(cart: Cart, oldKey: string, line: Omit<CartLine, "key">): Cart {
  const index = cart.lines.findIndex((l) => l.key === oldKey);
  const without = { ...cart, lines: cart.lines.filter((l) => l.key !== oldKey) };
  const added = addLine(without, line);
  if (index < 0) return added;
  // Düzenlenen satır listedeki yerini korusun.
  const newKey = cartLineKey({ ...line, modifiers: normalizeModifiers(line.modifiers), note: sanitizeNote(line.note, ORDER_LIMITS.itemNoteMax) });
  const moved = added.lines.find((l) => l.key === newKey)!;
  const rest = added.lines.filter((l) => l.key !== newKey);
  rest.splice(Math.min(index, rest.length), 0, moved);
  return { ...added, lines: rest };
}

export function setQuantity(cart: Cart, key: string, quantity: number): Cart {
  const lines = quantity <= 0 ? cart.lines.filter((l) => l.key !== key) : cart.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(ORDER_LIMITS.maxQuantityPerLine, quantity) } : l));
  return { ...cart, lines, updatedAt: Date.now() };
}

export function cartItemCount(cart: Pick<Cart, "lines">): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}

export function toSelections(cart: Pick<Cart, "lines">): ItemSelection[] {
  return cart.lines.map((l) => ({ product: l.product, variant: l.variant, modifiers: l.modifiers, quantity: l.quantity, note: l.note, expectedUnitPriceMinor: l.unitPriceMinor }));
}

// ─── Depolama (güvenilmeyen girdi) ──────────────────────────────────────────

const ref = z.string().min(1).max(80);
const storedLine = z.object({
  key: z.string().max(600),
  product: ref,
  variant: ref.nullable(),
  modifiers: z.array(z.object({ group: ref, modifier: ref })).max(40),
  quantity: z.number().int().min(1).max(ORDER_LIMITS.maxQuantityPerLine),
  note: z.string().max(ORDER_LIMITS.itemNoteMax).nullable(),
  unitPriceMinor: z.number().int().min(0),
  name: z.string().max(200),
  detail: z.string().max(400),
});
const storedCart = z.object({
  version: z.literal(1),
  scope: z.string().max(64),
  restaurant: z.string().max(200),
  table: z.string().max(80),
  returnPath: z.string().max(200).regex(/^\/t\/[A-Za-z0-9_-]{22}$/),
  lines: z.array(storedLine).max(ORDER_LIMITS.maxLines),
  note: z.string().max(ORDER_LIMITS.orderNoteMax),
  updatedAt: z.number(),
});

/** localStorage'dan okunan değeri doğrular; bozuk / süresi dolmuş / biçimsiz → null. */
export function parseStoredCart(raw: string | null, now = Date.now()): Cart | null {
  if (!raw) return null;
  try {
    const parsed = storedCart.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (now - parsed.data.updatedAt > CART_TTL_MS) return null;
    // Anahtarları yeniden hesapla (depodaki anahtara güvenilmez).
    return { ...parsed.data, lines: parsed.data.lines.map((l) => ({ ...l, key: cartLineKey(l) })) };
  } catch {
    return null;
  }
}
