import { z } from "zod";

/** Super Admin eğitim metni. İçerik düz metindir (HTML yorumlanmaz); garsona yalnızca ilgili bölümleri gider. */
export const knowledgeSchema = z.object({
  title: z.string({ error: "Gerekli." }).trim().min(2, "En az 2 karakter.").max(120, "En fazla 120 karakter."),
  content: z.string({ error: "Gerekli." }).trim().min(20, "En az 20 karakter.").max(30_000, "En fazla 30.000 karakter."),
  active: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
});
export type KnowledgeInput = z.output<typeof knowledgeSchema>;
