import "server-only";
import { createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";

/**
 * Public menü / sepet için OPAK referanslar. Tarayıcıya varyant / ekstra grubu / ekstra veritabanı kimliği
 * gönderilmez; bunun yerine kiracıya özel, tahmin edilemez kısa bir referans gider:
 *   ref = base64url(HMAC-SHA256(sunucu sırrı, "menu-ref:" + tenantId + ":" + kimlik))[0..12]
 * Sunucu gönderimde ürünün kendi varyant / ekstralarının referanslarını yeniden hesaplayıp eşler — böylece başka
 * kiracının (ya da başka ürünün) kaydına referans uydurmak mümkün değildir ve kimlikler sızmaz.
 */
const CONTEXT = "masanova.menu-ref.v1:";

export type MenuRefFn = (id: string) => string;

export function createMenuRefs(tenantId: string): MenuRefFn {
  const secret = getServerEnv().QR_TOKEN_SECRET;
  const cache = new Map<string, string>();
  return (id: string) => {
    const hit = cache.get(id);
    if (hit) return hit;
    const ref = createHmac("sha256", secret).update(`${CONTEXT}${tenantId}:${id}`, "utf8").digest().subarray(0, 9).toString("base64url");
    cache.set(id, ref);
    return ref;
  };
}

/**
 * Masa kapsamı: sepeti bir masaya bağlayan opak değer (tarayıcı depolaması anahtarı). Yetki DEĞİLDİR — yalnızca
 * "bu sepet başka bir masaya ait" uyarısı için. Kiracı / masa kimliği içermez, tersine çevrilemez.
 */
export function cartScopeFor(tenantId: string, tableId: string): string {
  return createHmac("sha256", getServerEnv().QR_TOKEN_SECRET).update(`masanova.cart-scope.v1:${tenantId}:${tableId}`, "utf8").digest().subarray(0, 12).toString("base64url");
}
