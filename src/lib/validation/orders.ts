import { z } from "zod";
import { ORDER_LIMITS } from "@/lib/orders/calculate";
import { sanitizeNote } from "@/lib/orders/notes";

/**
 * Müşteri sipariş girdisi. İstemci YALNIZCA seçim gönderir (ürün kısa adı, opak varyant / ekstra referansları,
 * adet, not, gördüğü birim fiyat). Fiyat, toplam, kiracı / şube / masa kimliği şemada YOKTUR — gelse bile
 * ayrıştırma sırasında atılır (Zod nesneleri bilinmeyen alanları düşürür).
 */
const ref = z.string().trim().regex(/^[A-Za-z0-9_-]{1,80}$/, "Geçersiz seçim.");

const note = (max: number) =>
  z
    .string()
    .max(max * 2, "Not çok uzun.")
    .nullish()
    .transform((v) => sanitizeNote(v ?? null, max));

export const orderItemSchema = z.object({
  product: z.string().trim().regex(/^[a-z0-9-]{1,80}$/, "Geçersiz ürün."),
  variant: ref.nullable(),
  modifiers: z.array(z.object({ group: ref, modifier: ref })).max(40),
  quantity: z.number().int().min(1).max(ORDER_LIMITS.maxQuantityPerLine),
  note: note(ORDER_LIMITS.itemNoteMax),
  expectedUnitPriceMinor: z.number().int().min(0).max(1_000_000_000).nullish(),
});

/** Kupon kodu en fazla 64 karakter (sunucu normalize eder); ödül opak kimlik. */
export const promotionRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coupon"), code: z.string().max(64) }),
  z.object({ kind: z.literal("reward"), rewardId: z.string().regex(/^[a-z0-9]{1,40}$/i) }),
]);

export const submitOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Sepet boş.").max(ORDER_LIMITS.maxLines),
  note: note(ORDER_LIMITS.orderNoteMax),
  /** Ödeme denemesi başına istemcinin ürettiği rastgele anahtar (tekrarlanan gönderim koruması). */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/, "Geçersiz istek."),
  locale: z.string().max(8),
  /** İsteğe bağlı TEK promosyon: kupon kodu YA DA sadakat ödülü. İndirim tutarı istemciden ALINMAZ. */
  promotion: promotionRequestSchema.nullish(),
});
export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;

export const checkCartSchema = z.object({ items: z.array(orderItemSchema).max(ORDER_LIMITS.maxLines), locale: z.string().max(8) });

export const previewPromotionSchema = z.object({ items: z.array(orderItemSchema).min(1).max(ORDER_LIMITS.maxLines), locale: z.string().max(8), promotion: promotionRequestSchema });

export const publicOrderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
