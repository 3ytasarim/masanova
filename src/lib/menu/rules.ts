/**
 * Menü iş kuralları — saf fonksiyonlar (servis katmanı uygular, testler doğrular).
 */

// ─── Kategori hiyerarşisi (en fazla 1 seviye) ──────────────────────────────

export type CategoryNode = { id: string; parentId: string | null };

export type HierarchyError = "self_parent" | "parent_not_found" | "parent_is_child" | "has_children";

/**
 * `categoryId` (yeni kayıtta null) için önerilen `parentId` geçerli mi?
 * `nodes` YALNIZCA aynı kiracının kategorileridir — başka kiracının kategorisi listede olmadığı için
 * "parent_not_found" döner (kiracılar arası üst kategori imkânsız).
 */
export function validateCategoryParent(categoryId: string | null, parentId: string | null, nodes: readonly CategoryNode[]): HierarchyError | null {
  if (parentId === null) return null;
  if (categoryId !== null && parentId === categoryId) return "self_parent";
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent) return "parent_not_found";
  if (parent.parentId !== null) return "parent_is_child"; // ikinci seviye yasak → döngü de imkânsız
  if (categoryId !== null && nodes.some((n) => n.parentId === categoryId)) return "has_children";
  return null;
}

export const HIERARCHY_MESSAGES: Record<HierarchyError, string> = {
  self_parent: "Kategori kendi üst kategorisi olamaz.",
  parent_not_found: "Üst kategori bulunamadı.",
  parent_is_child: "Alt kategori, başka bir kategorinin üst kategorisi olamaz (en fazla bir seviye).",
  has_children: "Alt kategorileri olan bir kategori başka bir kategorinin altına taşınamaz.",
};

// ─── Ekstra grubu seçim kuralları ──────────────────────────────────────────

export type ModifierRuleInput = { required: boolean; minSelect: number; maxSelect: number };

export function validateModifierGroupRules(input: ModifierRuleInput): string | null {
  if (!Number.isInteger(input.minSelect) || !Number.isInteger(input.maxSelect)) return "Seçim sayıları tam sayı olmalı.";
  if (input.minSelect < 0 || input.maxSelect < 1) return "En az seçim 0'dan, en fazla seçim 1'den küçük olamaz.";
  if (input.maxSelect > 50) return "En fazla seçim 50'yi geçemez.";
  if (input.maxSelect < input.minSelect) return "En fazla seçim, en az seçimden küçük olamaz.";
  if (input.required && input.minSelect < 1) return "Zorunlu grupta en az seçim 1 olmalı.";
  if (!input.required && input.minSelect > 0) return "En az seçim 1 veya daha fazlaysa grup zorunlu olarak işaretlenmeli.";
  return null;
}

/** Gelecekteki sipariş motoru için: bir müşteri seçiminin grup kurallarına uygunluğu. */
export function validateModifierSelection(rule: ModifierRuleInput, selectedCount: number, activeModifierCount: number): string | null {
  const max = Math.min(rule.maxSelect, activeModifierCount);
  if (selectedCount < rule.minSelect) return `En az ${rule.minSelect} seçim yapılmalı.`;
  if (selectedCount > max) return `En fazla ${max} seçim yapılabilir.`;
  return null;
}

// ─── Sıralama ──────────────────────────────────────────────────────────────

/** Komşu ile yer değiştirme için hedef: sıralı listede `id`'nin yukarı/aşağı komşusu (yoksa null). */
export function neighbourFor<T extends { id: string }>(ordered: readonly T[], id: string, direction: "up" | "down"): T | null {
  const index = ordered.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const target = direction === "up" ? index - 1 : index + 1;
  return ordered[target] ?? null;
}
