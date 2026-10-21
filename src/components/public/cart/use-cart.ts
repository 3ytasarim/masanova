"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CART_STORAGE_PREFIX, emptyCart, parseStoredCart, type Cart } from "@/lib/orders/cart";

/**
 * Sepet deposu — tarayıcının localStorage'ı (hesap yok, kişisel veri yok). Her masa kapsamı ayrı anahtardadır;
 * sepet başka masaya / kiracıya asla taşınmaz. Okunan veri güvenilmez girdi olarak doğrulanır (parseStoredCart).
 * localStorage kullanılamıyorsa (gizli sekme, engelli depolama) sepet bellekte çalışır.
 */
const CHANGE_EVENT = "masanova:cart-change";
const memory = new Map<string, string>();

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export type CartMeta = { scope: string; restaurant: string; table: string; returnPath: string };

export function useCart(meta: CartMeta | null) {
  const key = meta ? `${CART_STORAGE_PREFIX}${meta.scope}` : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? safeGet(key) : null),
    () => null,
  );
  const cart = useMemo<Cart | null>(() => (meta ? (parseStoredCart(raw) ?? null) : null), [raw, meta]);

  const update = useCallback(
    (fn: (current: Cart) => Cart | null) => {
      if (!meta || !key) return;
      const current = parseStoredCart(safeGet(key)) ?? emptyCart(meta);
      const next = fn({ ...current, restaurant: meta.restaurant, table: meta.table, returnPath: meta.returnPath });
      safeSet(key, next && next.lines.length + next.note.length > 0 ? JSON.stringify(next) : null);
    },
    [key, meta],
  );
  /** Depodaki güncel sepet (React durumunu beklemeden — art arda sesli eklemelerde doğru özet için). */
  const read = useCallback((): Cart | null => (key ? parseStoredCart(safeGet(key)) : null), [key]);

  return { cart, update, read };
}

/** Bu cihazda BAŞKA bir masa kapsamına ait, dolu ve süresi geçmemiş sepetler ("bu sepet farklı bir masaya ait"). */
export function useOtherCarts(scope: string | null) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(CART_STORAGE_PREFIX) && k !== `${CART_STORAGE_PREFIX}${scope}`) keys.push(k);
        }
        return keys
          .sort()
          .map((k) => `${k}\u0000${window.localStorage.getItem(k) ?? ""}`)
          .join("\u0001");
      } catch {
        return "";
      }
    },
    () => "",
  );
  const carts = useMemo(
    () =>
      snapshot
        ? snapshot.split("\u0001").flatMap((entry) => {
            const [storageKey, raw] = entry.split("\u0000");
            const cart = parseStoredCart(raw ?? null);
            return cart && cart.lines.length ? [{ storageKey: storageKey!, cart }] : [];
          })
        : [],
    [snapshot],
  );
  const clear = useCallback((storageKey: string) => safeSet(storageKey, null), []);
  return { carts, clear };
}

// ─── Siparişlerim (yalnızca bu cihazdaki ipuçları; erişim sunucuda masa bağlamıyla doğrulanır) ───
const ORDERS_PREFIX = "mn_orders:";
export type RecentOrder = { publicId: string; number: string; at: number };

export function useRecentOrders(scope: string | null) {
  const key = scope ? `${ORDERS_PREFIX}${scope}` : null;
  const raw = useSyncExternalStore(subscribe, () => (key ? safeGet(key) : null), () => null);
  const orders = useMemo<RecentOrder[]>(() => {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((o): o is RecentOrder => !!o && typeof o.publicId === "string" && /^[A-Za-z0-9_-]{22}$/.test(o.publicId) && typeof o.number === "string" && typeof o.at === "number")
        .slice(0, 10);
    } catch {
      return [];
    }
  }, [raw]);
  const remember = useCallback(
    (order: RecentOrder) => {
      if (!key) return;
      // Eski kayıtlar yazarken budanır (sunucu zaten yalnızca son 24 saati gösterir).
      const next = [order, ...orders.filter((o) => o.publicId !== order.publicId && order.at - o.at < 24 * 60 * 60 * 1000)].slice(0, 10);
      safeSet(key, JSON.stringify(next));
    },
    [key, orders],
  );
  return { orders, remember };
}
