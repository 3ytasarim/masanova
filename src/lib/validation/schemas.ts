import { z } from "zod";
import { RESERVED_SUBDOMAINS, normalizeHost } from "@/lib/domain/normalize-domain";

/**
 * Yeniden kullanılabilir Zod şemaları. Ham form / API girdisi hiçbir zaman doğrudan kullanılmaz:
 * her Server Action ve Route Handler girdiyi önce buradaki şemalardan biriyle parse eder.
 */

export const emailSchema = z
  .string({ error: "E-posta gerekli." })
  .trim()
  .toLowerCase()
  .max(254, "E-posta çok uzun.")
  .pipe(z.email({ error: "Geçerli bir e-posta girin." }));

/** Girişte parola: politika ayrıntısı sızdırılmaz, yalnızca makul sınırlar (argon2 DoS koruması için üst sınır). */
export const loginPasswordSchema = z
  .string({ error: "Parola gerekli." })
  .min(1, "Parola gerekli.")
  .max(256, "Parola çok uzun.");

/** Yeni parola politikası (hesap oluşturma / değiştirme). */
export const newPasswordSchema = z
  .string()
  .min(12, "Parola en az 12 karakter olmalı.")
  .max(256, "Parola çok uzun.");

export const loginSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

/** URL-güvenli kısa ad (aynı zamanda geçerli DNS etiketi): küçük harf, rakam, tekli tire; başta/sonda tire yok. */
export const slugSchema = z
  .string({ error: "Gerekli." })
  .trim()
  .toLowerCase()
  .min(2, "En az 2 karakter.")
  .max(63, "En fazla 63 karakter.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Yalnızca küçük harf, rakam ve tekli tire kullanılabilir.");

/** Kiracı kısa adı: slug kuralları + platforma ayrılmış adlar yasak (kısa ad varsayılan alt alan adıdır). */
export const tenantSlugSchema = slugSchema.refine((v) => !RESERVED_SUBDOMAINS.has(v), "Bu ad platforma ayrılmıştır.");

/** Özel alan adı: normalize edilir, en az bir nokta içermeli. */
export const hostnameSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const host = normalizeHost(v);
    if (!host || !host.includes(".") || host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      ctx.addIssue({ code: "custom", message: "Geçerli bir alan adı girin." });
      return z.NEVER;
    }
    return host;
  });
