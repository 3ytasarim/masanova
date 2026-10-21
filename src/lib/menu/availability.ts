/**
 * MERKEZİ ERİŞİLEBİLİRLİK ÇÖZÜMLEYİCİ — public menü, sipariş ve AI aynı kararı buradan alır.
 *
 * Sonuç:
 *   "available"   → menüde görünür, sipariş edilebilir
 *   "sold_out"    → menüde "tükendi" olarak görünür, sipariş edilemez
 *   "unavailable" → menüde hiç görünmez
 *
 * Kurallar (sırayla, ilk eşleşen kazanır):
 *   arşivlenmiş ürün / pasif ürün / pasif kategori (veya üst kategorisi) / pasif şube → unavailable
 *   şube "satılmıyor" (BranchProduct.available === false)                           → unavailable
 *   seçili varyant arşivlenmiş/pasif                                                → unavailable
 *   şube tükendi geçersiz kılması varsa o; yoksa ürünün genel soldOut değeri         → sold_out
 *   aksi halde                                                                       → available
 */
export type AvailabilityStatus = "available" | "sold_out" | "unavailable";
export type AvailabilityReason =
  | "archived"
  | "product_inactive"
  | "category_inactive"
  | "branch_inactive"
  | "branch_disabled"
  | "variant_inactive"
  | "sold_out"
  | "branch_sold_out";

export type AvailabilityInput = {
  product: { active: boolean; soldOut: boolean; archivedAt: Date | null };
  category?: { active: boolean; parent?: { active: boolean } | null } | null;
  branch?: { active: boolean } | null;
  branchProduct?: { available: boolean | null; soldOut: boolean | null } | null;
  variant?: { active: boolean; archivedAt: Date | null } | null;
};

export type ResolvedAvailability = {
  status: AvailabilityStatus;
  visible: boolean;
  orderable: boolean;
  reason: AvailabilityReason | null;
};

const unavailable = (reason: AvailabilityReason): ResolvedAvailability => ({ status: "unavailable", visible: false, orderable: false, reason });

export function resolveAvailability(input: AvailabilityInput): ResolvedAvailability {
  const { product, category, branch, branchProduct, variant } = input;

  if (product.archivedAt) return unavailable("archived");
  if (!product.active) return unavailable("product_inactive");
  if (category && (!category.active || (category.parent && !category.parent.active))) return unavailable("category_inactive");
  if (branch && !branch.active) return unavailable("branch_inactive");
  if (branchProduct?.available === false) return unavailable("branch_disabled");
  if (variant && (variant.archivedAt || !variant.active)) return unavailable("variant_inactive");

  const branchSoldOut = branchProduct?.soldOut;
  if (branchSoldOut === true) return { status: "sold_out", visible: true, orderable: false, reason: "branch_sold_out" };
  if (branchSoldOut !== false && product.soldOut) return { status: "sold_out", visible: true, orderable: false, reason: "sold_out" };

  return { status: "available", visible: true, orderable: true, reason: null };
}
