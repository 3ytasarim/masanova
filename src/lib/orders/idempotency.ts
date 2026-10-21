import { createHash, randomBytes } from "node:crypto";
import type { ItemSelection } from "@/lib/orders/calculate";
import { normalizeModifiers } from "@/lib/orders/cart";

/**
 * Tekrarlanan gönderim koruması (sunucu). İstemci her "Siparişi Gönder" onayında bir anahtar üretir ve aynı
 * denemenin yeniden denemelerinde AYNI anahtarı yollar. Veritabanında (tenant_id, anahtar özeti) benzersizdir:
 *   aynı anahtar + aynı içerik  → mevcut sipariş döner (yeni sipariş oluşmaz)
 *   aynı anahtar + farklı içerik → reddedilir (anahtar yeniden kullanımı)
 * Anahtarın kendisi saklanmaz / loglanmaz.
 */
export function hashIdempotencyKey(key: string): string {
  return createHash("sha256").update(`idem:${key}`, "utf8").digest("hex");
}

/** Normalize edilmiş isteğin özeti (masa + kalemler + not). Beklenen fiyat dahil değil — içerik aynıysa aynı sipariştir. */
export function hashOrderRequest(input: { tableId: string; items: readonly ItemSelection[]; note: string | null; promotion?: string | null }): string {
  const normalized = {
    t: input.tableId,
    n: input.note ?? "",
    i: input.items.map((i) => [i.product, i.variant ?? "", normalizeModifiers(i.modifiers).map((m) => `${m.group}.${m.modifier}`), i.quantity, i.note ?? ""]),
    // Promosyon isteği (kupon kodu / ödül) içeriğin parçasıdır: aynı anahtarla farklı promosyon → ret. Yoksa eski özet korunur.
    ...(input.promotion ? { p: input.promotion } : {}),
  };
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

/** Müşteriye görünen sipariş kimliği: 128 bit, base64url (tahmin edilemez, sıralı değil). */
export function newPublicOrderId(): string {
  return randomBytes(16).toString("base64url");
}
