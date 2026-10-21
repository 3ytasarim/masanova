import { contrastRatio, isHexColor, readableTextColor } from "@/lib/tables/contrast";
import type { PublicMenuStyleKey, PublicTheme } from "@/lib/public-menu/types";

/**
 * Public menü temasının TEK çözümleyicisi (sunucu sayfası ve paneldeki canlı önizleme aynı fonksiyonu kullanır).
 * Marka renkleri körü körüne uygulanmaz: zemin üzerindeki metin/simge ≥ 4,5:1 olacak şekilde düzeltilir.
 * İşletme serbest CSS / HTML giremez; yalnızca ön tanımlı düzen + doğrulanmış renk + metin.
 */
export const PUBLIC_MENU_STYLES = ["COMPACT", "VISUAL", "LUXURY", "MODERN"] as const satisfies readonly PublicMenuStyleKey[];
export const DEFAULT_BRAND = "#1c1917";
/** Public menünün açık zemin rengi (kontrast hesapları buna göre). */
export const PUBLIC_SURFACE = "#faf8f5";
export const WELCOME_MAX = 160;

export type PublicThemeInput = {
  style?: PublicMenuStyleKey | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  welcomeText?: string | null;
  heroImageUrl?: string | null;
  logoUrl?: string | null;
  showNutrition?: boolean;
  showAllergens?: boolean;
  showIngredients?: boolean;
  showPreparationTime?: boolean;
  showPoweredBy?: boolean;
};

export function resolvePublicTheme(input: PublicThemeInput): PublicTheme {
  const brand = isHexColor(input.primaryColor) ? input.primaryColor.toLowerCase() : DEFAULT_BRAND;
  const accentCandidate = isHexColor(input.accentColor) ? input.accentColor.toLowerCase() : brand;
  // Vurgu metni açık zeminde okunmalı; değilse marka rengi, o da değilse koyu nötr.
  const accentText =
    contrastRatio(accentCandidate, PUBLIC_SURFACE) >= 4.5 ? accentCandidate : contrastRatio(brand, PUBLIC_SURFACE) >= 4.5 ? brand : DEFAULT_BRAND;
  const welcome = input.welcomeText?.replace(/\s+/g, " ").trim().slice(0, WELCOME_MAX) || null;
  return {
    style: input.style && (PUBLIC_MENU_STYLES as readonly string[]).includes(input.style) ? input.style : "MODERN",
    brand,
    onBrand: readableTextColor(brand, "#ffffff"),
    accentText,
    welcomeText: welcome,
    heroImageUrl: input.heroImageUrl || null,
    logoUrl: input.logoUrl || null,
    show: {
      nutrition: input.showNutrition ?? true,
      allergens: input.showAllergens ?? true,
      ingredients: input.showIngredients ?? true,
      preparationTime: input.showPreparationTime ?? true,
      poweredBy: input.showPoweredBy ?? true,
    },
  };
}
