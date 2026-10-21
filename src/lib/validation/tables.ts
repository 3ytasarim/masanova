import { z } from "zod";
import { LABEL_MAX_HEIGHT_MM, LABEL_MAX_WIDTH_MM, LABEL_MIN_MM, LABEL_SIZE_PRESETS, LABEL_SIZE_PRESET_KEYS } from "@/lib/tables/label-geometry";
import { CTA_MAX, DEFAULT_LABEL_OPTIONS, INFO_MAX, LABEL_TEMPLATE_KEYS, type LabelOptions } from "@/lib/tables/label-options";
import { BULK_TABLE_MAX, TABLE_NUMBER_MAX } from "@/lib/tables/naming";
import { slugSchema } from "@/lib/validation/schemas";

/**
 * Masa / bölge / etiket şemaları. tenantId ve branchId güvenilir alan olarak hiçbir şemada yoktur; şube
 * seçimi yalnızca kapsam içinde aranır. Kimlikler biçim olarak süzülür.
 */

export const tableIdSchema = z.string().trim().regex(/^[a-z0-9]{20,40}$/, "Geçersiz kimlik.");

const optionalId = z
  .union([z.literal(""), tableIdSchema])
  .optional()
  .transform((v) => (v ? v : null));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${max} karakter.`)
    .optional()
    .transform((v) => (v ? v : null));

const optionalInt = (min: number, max: number, label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const n = Number(v.trim());
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} ${min}–${max} arasında tam sayı olmalı.` });
        return z.NEVER;
      }
      return n;
    });

const requiredInt = (min: number, max: number, label: string) =>
  z.string({ error: "Gerekli." }).transform((v, ctx) => {
    const n = Number(v.trim());
    if (!v.trim() || !Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `${label} ${min}–${max} arasında tam sayı olmalı.` });
      return z.NEVER;
    }
    return n;
  });

export const areaSchema = z.object({
  name: z.string({ error: "Gerekli." }).trim().min(1, "Gerekli.").max(60, "En fazla 60 karakter."),
  slug: slugSchema.refine((v) => v.length <= 60, "En fazla 60 karakter."),
  description: optionalText(200),
  active: z.boolean(),
});
export type AreaInput = z.infer<typeof areaSchema>;

export const tableSchema = z.object({
  name: z.string({ error: "Gerekli." }).trim().min(1, "Gerekli.").max(40, "En fazla 40 karakter."),
  number: optionalInt(1, TABLE_NUMBER_MAX, "Masa numarası"),
  code: z
    .string()
    .trim()
    .max(20, "En fazla 20 karakter.")
    .regex(/^[\p{L}\p{N} ._/-]*$/u, "Yalnızca harf, rakam, boşluk ve . _ / - kullanılabilir.")
    .optional()
    .transform((v) => (v ? v : null)),
  capacity: optionalInt(1, 50, "Kapasite"),
  capacityMin: optionalInt(1, 50, "En az kişi"),
  reservable: z.boolean().default(true),
  diningAreaId: optionalId,
  active: z.boolean(),
}).refine((v) => v.capacityMin === null || (v.capacity !== null && v.capacityMin <= v.capacity), { path: ["capacityMin"], message: "En az kişi, kapasiteden büyük olamaz (kapasite de girilmeli)." });
export type TableInput = z.infer<typeof tableSchema>;

export const bulkTablesSchema = z.object({
  diningAreaId: optionalId,
  count: requiredInt(1, BULK_TABLE_MAX, "Adet"),
  startNumber: requiredInt(1, TABLE_NUMBER_MAX, "Başlangıç numarası"),
  pattern: z
    .string({ error: "Gerekli." })
    .trim()
    .min(1, "Gerekli.")
    .max(30, "En fazla 30 karakter.")
    .refine((v) => (v.match(/\{n\}/g) ?? []).length <= 1, "{n} en fazla bir kez kullanılabilir."),
  capacity: optionalInt(1, 50, "Varsayılan kapasite"),
});
export type BulkTablesInput = z.infer<typeof bulkTablesSchema>;

// ─── Etiket seçenekleri ──────────────────────────────────────────────────────

const flag = (fallback: boolean) =>
  z
    .enum(["0", "1"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "1"));

const mm = (min: number, max: number, label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} ${min}–${max} mm arasında olmalı.` });
        return z.NEVER;
      }
      return Math.round(n * 10) / 10;
    });

/** URL / form parametreleri → doğrulanmış LabelOptions. Ön ayarlı boyutta en/boy ön ayardan alınır. */
export const labelOptionsSchema = z
  .object({
    sablon: z.enum(LABEL_TEMPLATE_KEYS, { error: "Geçersiz şablon." }).optional(),
    boyut: z.enum([...LABEL_SIZE_PRESET_KEYS, "custom"] as const, { error: "Geçersiz boyut." }).optional(),
    en: mm(LABEL_MIN_MM, LABEL_MAX_WIDTH_MM, "Genişlik"),
    boy: mm(LABEL_MIN_MM, LABEL_MAX_HEIGHT_MM, "Yükseklik"),
    tasma: flag(DEFAULT_LABEL_OPTIONS.bleed),
    cta: z.string().trim().max(CTA_MAX, `Çağrı metni en fazla ${CTA_MAX} karakter.`).optional(),
    logo: flag(DEFAULT_LABEL_OPTIONS.showLogo),
    ad: flag(DEFAULT_LABEL_OPTIONS.showName),
    imza: flag(DEFAULT_LABEL_OPTIONS.poweredBy),
    bilgi: z.string().trim().max(INFO_MAX, `Bilgi satırı en fazla ${INFO_MAX} karakter.`).optional(),
    qr: z.enum(["brand", "black"]).optional(),
  })
  .transform((v, ctx): LabelOptions => {
    const size = v.boyut ?? DEFAULT_LABEL_OPTIONS.size;
    let width: number;
    let height: number;
    if (size === "custom") {
      if (v.en === undefined || v.boy === undefined) {
        ctx.addIssue({ code: "custom", path: ["en"], message: "Özel boyut için genişlik ve yükseklik gerekli." });
        return z.NEVER;
      }
      width = v.en;
      height = v.boy;
    } else {
      ({ width, height } = LABEL_SIZE_PRESETS[size]);
    }
    return {
      template: v.sablon ?? DEFAULT_LABEL_OPTIONS.template,
      size,
      width,
      height,
      bleed: v.tasma,
      cta: v.cta || DEFAULT_LABEL_OPTIONS.cta,
      showLogo: v.logo,
      showName: v.ad,
      poweredBy: v.imza,
      info: v.bilgi ?? "",
      qrColor: v.qr ?? DEFAULT_LABEL_OPTIONS.qrColor,
    };
  });

/** URLSearchParams / FormData → düz nesne (yalnızca string değerler). */
export function paramsToRecord(source: URLSearchParams | FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of source.entries()) if (typeof value === "string" && !(key in out)) out[key] = value;
  return out;
}

/** Toplu baskı hedefi: tüm şube / tek bölge / seçili masalar. */
export const sheetTargetSchema = z.discriminatedUnion("kapsam", [
  z.object({ kapsam: z.literal("sube"), sube: tableIdSchema }),
  z.object({ kapsam: z.literal("bolge"), sube: tableIdSchema, bolge: tableIdSchema }),
  z.object({ kapsam: z.literal("secili"), sube: tableIdSchema, masalar: z.array(tableIdSchema).min(1, "En az bir masa seçin.").max(1000) }),
]);
export type SheetTarget = z.infer<typeof sheetTargetSchema>;
