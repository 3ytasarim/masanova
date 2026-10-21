import { z } from "zod";
import { emailSchema, hostnameSchema, newPasswordSchema, slugSchema, tenantSlugSchema } from "@/lib/validation/schemas";
import { isValidCountry, isValidCurrency, isValidLocale, isValidTimeZone } from "@/lib/validation/intl";

/**
 * Kiracı yönetimi şemaları. Aynı şemalar sihirbazda (istemci, anlık geri bildirim) ve Server Action'da
 * (sunucu, tek yetkili doğrulama) kullanılır. tenantId, rol, verified, isPrimary gibi güvenilir alanlar
 * BİLİNÇLİ OLARAK hiçbir şemada yoktur — sunucu belirler.
 */

/** Boş string → undefined; diğer durumda kırpılmış değer. */
const optionalText = (max: number, message = `En fazla ${max} karakter.`) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : undefined));

export const businessNameSchema = z.string({ error: "Gerekli." }).trim().min(2, "En az 2 karakter.").max(120, "En fazla 120 karakter.");
export const personNameSchema = z.string({ error: "Gerekli." }).trim().min(1, "Gerekli.").max(80, "En fazla 80 karakter.");

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB biçiminde olmalı.")
  .transform((v) => v.toLowerCase());
const optionalColor = z
  .union([z.literal(""), hexColorSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

export const timezoneSchema = z.string({ error: "Gerekli." }).trim().refine(isValidTimeZone, "Geçersiz saat dilimi.");
export const currencySchema = z.string({ error: "Gerekli." }).trim().toUpperCase().refine(isValidCurrency, "Geçersiz para birimi.");
export const localeSchema = z.string({ error: "Gerekli." }).trim().refine(isValidLocale, "Desteklenmeyen dil.");
export const countrySchema = z.string({ error: "Gerekli." }).trim().toUpperCase().refine(isValidCountry, "Geçersiz ülke.");

const phoneSchema = z
  .string()
  .trim()
  .max(24, "Telefon çok uzun.")
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^\+?[0-9 ()-]{7,22}$/.test(v), "Geçerli bir telefon girin.");

const optionalEmail = z
  .union([z.literal(""), emailSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

/** Logo şimdilik yalnızca https URL (nesne depolama Sprint 3+; bkz. docs/architecture.md › Görseller). */
const logoUrlSchema = z
  .union([
    z.literal(""),
    z
      .url({ error: "Geçerli bir URL girin." })
      .max(2048)
      .refine((v) => v.startsWith("https://"), "Logo adresi https:// ile başlamalı."),
  ])
  .optional()
  .transform((v) => (v ? v : undefined));

// ─── Şube ───────────────────────────────────────────────────────────────────

export const branchFieldsSchema = z.object({
  name: z.string({ error: "Gerekli." }).trim().min(2, "En az 2 karakter.").max(80, "En fazla 80 karakter."),
  slug: slugSchema,
  phone: phoneSchema,
  email: optionalEmail,
  country: countrySchema,
  city: optionalText(80),
  district: optionalText(80),
  address: optionalText(300),
  timezone: timezoneSchema,
  currency: currencySchema,
  locale: localeSchema,
});
export type BranchFieldsInput = z.input<typeof branchFieldsSchema>;
export type BranchFields = z.output<typeof branchFieldsSchema>;

export const branchUpdateSchema = branchFieldsSchema.extend({ active: z.boolean() });
export type BranchUpdate = z.output<typeof branchUpdateSchema>;

// ─── Marka ──────────────────────────────────────────────────────────────────

export const brandingSchema = z.object({
  logoUrl: logoUrlSchema,
  primaryColor: optionalColor,
  secondaryColor: optionalColor,
  accentColor: optionalColor,
});
export type Branding = z.output<typeof brandingSchema>;

// ─── Sihirbaz ───────────────────────────────────────────────────────────────

export const businessStepSchema = z.object({ name: businessNameSchema, slug: tenantSlugSchema });

export const domainStepSchema = z.object({
  /** Platform alt alan etiketi (varsayılan: kısa ad). Her kiracının bir platform alt alanı olur. */
  subdomain: tenantSlugSchema,
  /** İsteğe bağlı özel alan adı — DNS doğrulanana kadar PENDING kalır, yayına çıkmaz. */
  customDomain: z
    .union([z.literal(""), hostnameSchema])
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const ownerStepSchema = z.discriminatedUnion("passwordMode", [
  z.object({
    passwordMode: z.literal("generate"),
    firstName: personNameSchema,
    lastName: personNameSchema,
    email: emailSchema,
  }),
  z.object({
    passwordMode: z.literal("manual"),
    firstName: personNameSchema,
    lastName: personNameSchema,
    email: emailSchema,
    password: newPasswordSchema,
  }),
]);

export const planSchema = z.enum(["STARTER", "PRO", "AI"], { error: "Bir paket seçin." });

export const onboardingSchema = z.object({
  business: businessStepSchema,
  branch: branchFieldsSchema,
  domain: domainStepSchema,
  owner: ownerStepSchema,
  branding: brandingSchema,
  plan: planSchema,
});
export type OnboardingInput = z.input<typeof onboardingSchema>;
export type Onboarding = z.output<typeof onboardingSchema>;

// ─── İşletme düzenleme ──────────────────────────────────────────────────────

export const tenantGeneralSchema = z.object({
  name: businessNameSchema,
  defaultLocale: localeSchema,
  defaultCurrency: currencySchema,
  timezone: timezoneSchema,
});

export const tenantSlugChangeSchema = z.object({
  slug: tenantSlugSchema,
  /** Kullanıcının uyarıyı okuduğunu açıkça onaylaması zorunlu. */
  confirm: z.literal("on", { error: "Değişikliği onaylamanız gerekiyor." }),
});

export const tenantStatusChangeSchema = z.object({
  to: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]),
  reason: optionalText(500),
});

export const customDomainCreateSchema = z.object({ hostname: hostnameSchema });

// ─── Demo talebi ────────────────────────────────────────────────────────────

export const demoRequestSchema = z.object({
  name: personNameSchema,
  businessName: businessNameSchema,
  phone: z.string({ error: "Gerekli." }).trim().regex(/^\+?[0-9 ()-]{7,22}$/, "Geçerli bir telefon girin."),
  email: emailSchema,
  city: optionalText(80),
  tableCount: z
    .union([z.literal(""), z.coerce.number().int("Tam sayı girin.").min(1, "En az 1.").max(5000, "Çok büyük.")])
    .optional()
    .transform((v) => (typeof v === "number" ? v : undefined)),
  message: optionalText(2000, "Mesaj en fazla 2000 karakter."),
});
export type DemoRequestInput = z.output<typeof demoRequestSchema>;

export const demoRequestUpdateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]),
  notes: optionalText(5000),
});
