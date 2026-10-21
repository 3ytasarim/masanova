import type { z } from "zod";

/**
 * Server Action dönüş biçimi — istemci bileşenleri tek tipte hata/başarı işler.
 * fieldErrors anahtarları nokta yollu alan adlarıdır ("business.slug", "owner.email").
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function invalid(error: z.ZodError, message = "Lütfen işaretli alanları düzeltin."): ActionResult<never> {
  return { ok: false, error: message, fieldErrors: fieldErrorsFromZod(error) };
}
