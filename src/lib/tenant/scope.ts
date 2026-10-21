/**
 * Kapsam (scope) nesneleri — veri erişim katmanının "kim adına?" sorusunun tek cevabı.
 *
 * TenantScope markalı (branded) bir tiptir: düz bir `{ tenantId: string }` nesnesi ya da tarayıcıdan gelen
 * bir string, kapsamlı repository fonksiyonlarına derleme anında VERİLEMEZ. Kapsam yalnızca güvenilir
 * sunucu bağlamından üretilir:
 *   - tenant-context.ts  → çözümlenmiş alan adından (public kiracı sitesi)
 *   - auth/guards.ts     → doğrulanmış oturumun kullanıcısından (restoran paneli)
 *
 * Bu modülün import'u ESLint (no-restricted-imports) ile yalnızca bu iki katman ve testlerle sınırlıdır.
 */
declare const tenantScopeBrand: unique symbol;
declare const platformScopeBrand: unique symbol;

export type TenantScope = {
  readonly tenantId: string;
  readonly [tenantScopeBrand]: true;
};

/** Platform geneli (tüm kiracılar) okuma yetkisi — yalnızca doğrulanmış SUPER_ADMIN oturumundan üretilir. */
export type PlatformScope = {
  readonly actorUserId: string;
  readonly [platformScopeBrand]: true;
};

export function createTenantScope(tenantId: string): TenantScope {
  if (!tenantId) throw new Error("TenantScope boş tenantId ile oluşturulamaz.");
  return Object.freeze({ tenantId }) as TenantScope;
}

export function createPlatformScope(actorUserId: string): PlatformScope {
  if (!actorUserId) throw new Error("PlatformScope boş kullanıcı ile oluşturulamaz.");
  return Object.freeze({ actorUserId }) as PlatformScope;
}
