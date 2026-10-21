import { z } from "zod";
import { externalUrlProvider } from "@/lib/storage/external-url-provider";
import { PUBLIC_MENU_STYLES, WELCOME_MAX } from "@/lib/public-menu/theme";
import { hexColorSchema } from "@/lib/validation/tenant";

/**
 * QR menü görünüm ayarları. Yalnızca ön tanımlı düzen, doğrulanmış renk (#RRGGBB), https görsel adresi
 * (harici URL sağlayıcısı kuralları: yerel/özel ağ yok) ve düz metin kabul edilir — HTML/CSS/JS girilemez.
 */
const optionalColor = z
  .union([z.literal(""), hexColorSchema])
  .optional()
  .transform((v) => (v ? v : null));

const optionalImage = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const result = externalUrlProvider.validateKey(v);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    return result.key;
  });

export const publicThemeSchema = z.object({
  style: z.enum(PUBLIC_MENU_STYLES, { error: "Geçersiz düzen." }),
  primaryColor: optionalColor,
  accentColor: optionalColor,
  logoUrl: optionalImage,
  heroImageUrl: optionalImage,
  welcomeText: z
    .string()
    .max(WELCOME_MAX, `En fazla ${WELCOME_MAX} karakter.`)
    .optional()
    .transform((v) => {
      const clean = v?.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
      return clean ? clean : null;
    }),
  /** "Google Yorum" sekmesi bağlantısı: yalnızca https Google adresleri (g.page, google.com, maps.app.goo.gl). */
  googleReviewUrl: z
    .string()
    .max(500, "En fazla 500 karakter.")
    .optional()
    .transform((v, ctx) => {
      const value = v?.trim();
      if (!value) return null;
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Geçerli bir bağlantı girin." });
        return z.NEVER;
      }
      if (url.protocol !== "https:" || !/(^|.)(google.[a-z.]+|g.page|goo.gl)$/i.test(url.hostname)) {
        ctx.addIssue({ code: "custom", message: "Yalnızca https Google bağlantısı (g.page, google.com, maps.app.goo.gl)." });
        return z.NEVER;
      }
      return url.toString();
    }),
  showNutrition: z.boolean(),
  showAllergens: z.boolean(),
  showIngredients: z.boolean(),
  showPreparationTime: z.boolean(),
  showPoweredBy: z.boolean(),
});

export type PublicThemeInput = z.infer<typeof publicThemeSchema>;
