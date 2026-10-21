import { z } from "zod";
import { AI_LANGUAGES } from "@/lib/voice/language-detection";

/** AI ayar formu. Sağlayıcı / anahtar alanı YOK (yalnızca sunucu ortam değişkenleri). */
export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  assistantName: z.string().trim().min(2, "En az 2 karakter.").max(40, "En fazla 40 karakter."),
  welcomeMessage: z
    .string()
    .trim()
    .max(200, "En fazla 200 karakter.")
    .optional()
    .transform((v) => (v ? v : null)),
  tone: z.enum(["WARM", "FORMAL", "CASUAL"]),
  customInstructions: z
    .string()
    .trim()
    .max(300, "En fazla 300 karakter.")
    .optional()
    .transform((v) => (v ? v : null)),
  allowRecommendations: z.boolean(),
  allowCartActions: z.boolean(),
  allowServiceActions: z.boolean(),
  voiceEnabled: z.boolean(),
  defaultVoiceLanguage: z
    .union([z.literal(""), z.enum(AI_LANGUAGES)])
    .optional()
    .transform((v) => (v ? v : null)),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;
