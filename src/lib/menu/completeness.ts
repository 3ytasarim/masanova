import { MENU_LOCALE_LABELS } from "@/config/menu";
import { isTranslationMissing } from "@/lib/menu/translation";

/**
 * Ürün içerik bütünlüğü — UYARIDIR, engel değildir: eksikler ürünün yayınlanmasını durdurmaz.
 * Panel listesinde rozet, ürün editöründe kontrol listesi olarak gösterilir.
 */
export type CompletenessCode =
  | "missing_image"
  | "missing_description"
  | "missing_price"
  | "missing_translation"
  | "missing_allergen_data"
  | "missing_category_active";

export type CompletenessIssue = { code: CompletenessCode; label: string; locale?: string };

export type CompletenessInput = {
  basePriceMinor: number;
  shortDescription: string | null;
  description: string | null;
  imageCount: number;
  /** Aktif varyant fiyatları (null = tabanı miras alır). */
  variantPrices: readonly (number | null)[];
  allergensConfirmedAt: Date | null;
  allergenCount: number;
  translations: readonly { locale: string; name: string | null }[];
  translatableLocales: readonly string[];
};

export function productCompleteness(input: CompletenessInput): { issues: CompletenessIssue[]; score: number } {
  const issues: CompletenessIssue[] = [];
  if (input.imageCount === 0) issues.push({ code: "missing_image", label: "Görsel yok" });
  if (!input.shortDescription?.trim() && !input.description?.trim()) issues.push({ code: "missing_description", label: "Açıklama yok" });

  const hasVariantPrice = input.variantPrices.some((p) => p !== null && p > 0);
  if (input.basePriceMinor <= 0 && !hasVariantPrice) issues.push({ code: "missing_price", label: "Fiyat yok" });

  if (!input.allergensConfirmedAt && input.allergenCount === 0) {
    issues.push({ code: "missing_allergen_data", label: "Alerjen bilgisi girilmedi" });
  }
  for (const locale of input.translatableLocales) {
    if (isTranslationMissing(input.translations, locale)) {
      issues.push({ code: "missing_translation", label: `${MENU_LOCALE_LABELS[locale] ?? locale} çevirisi yok`, locale });
    }
  }

  const checks = 4 + input.translatableLocales.length;
  const score = Math.round(((checks - issues.length) / checks) * 100);
  return { issues, score: Math.max(0, score) };
}
