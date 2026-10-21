import { z } from "zod";

/**
 * Tarayıcıya açılabilen (NEXT_PUBLIC_*) değişkenler. Next.js bunları derleme anında satır içine yazar;
 * bu yüzden her biri process.env üzerinden AÇIKÇA okunmalı (dinamik erişim istemci paketinde çalışmaz).
 */
const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_ROOT_DOMAIN: z
    .string()
    .min(1)
    .regex(/^[a-z0-9.-]+(:\d{1,5})?$/i, "alan adı (ve isteğe bağlı port) olmalı, protokol içermemeli")
    .default("localhost:3000"),
  /** Pazarlama sitesi WhatsApp iletişim numarası (isteğe bağlı; yalnızca rakam, uluslararası biçim). Boşsa düğme gösterilmez. */
  NEXT_PUBLIC_CONTACT_WHATSAPP: z.string().max(20).optional(),
});

const parsed = publicSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
  NEXT_PUBLIC_CONTACT_WHATSAPP: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP,
});

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
  throw new Error(`Geçersiz public ortam değişkenleri → ${problems}`);
}

export const publicEnv = parsed.data;
