import { z } from "zod";
import { tableIdSchema } from "@/lib/validation/tables";

/**
 * Hazırlama istasyonu şemaları. tenantId / branchId güvenilir alan değildir (kapsam oturumdan; şube kapsam içinde aranır).
 */
export const STATION_TYPES = ["KITCHEN", "BAR", "DESSERT", "COLD", "GRILL", "CUSTOM"] as const;
export type StationTypeKey = (typeof STATION_TYPES)[number];

export const STATION_TYPE_LABELS: Record<StationTypeKey, string> = {
  KITCHEN: "Mutfak",
  BAR: "Bar",
  DESSERT: "Tatlı",
  COLD: "Soğuk mutfak",
  GRILL: "Izgara",
  CUSTOM: "Diğer",
};

export const stationSchema = z.object({
  name: z.string().trim().min(2, "En az 2 karakter.").max(40, "En fazla 40 karakter."),
  type: z.enum(STATION_TYPES, { error: "Geçersiz istasyon tipi." }),
  active: z.boolean(),
});
export type StationInput = z.infer<typeof stationSchema>;

/** Ürün → istasyon atamaları (bir şube için). Boş liste = şube varsayılanına düşer. */
export const productStationsSchema = z.object({
  branchId: tableIdSchema,
  stationIds: z.array(tableIdSchema).max(10, "En fazla 10 istasyon.").transform((ids) => [...new Set(ids)]),
});

export const cancelReasonSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(3, "İptal nedeni en az 3 karakter olmalı.").max(200, "En fazla 200 karakter."));
