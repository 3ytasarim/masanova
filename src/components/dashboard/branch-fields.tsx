import { LOCALES, type LocaleOptions } from "@/lib/validation/intl";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type BranchDefaults = {
  name?: string;
  slug?: string;
  phone?: string | null;
  email?: string | null;
  country?: string;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  timezone?: string;
  currency?: string;
  locale?: string;
};

const LOCALE_LABELS: Record<string, string> = {
  tr: "Türkçe", en: "English", de: "Deutsch", ru: "Русский", ar: "العربية", fr: "Français", es: "Español",
  it: "Italiano", nl: "Nederlands", fa: "فارسی", az: "Azərbaycan", ka: "ქართული", uk: "Українська",
};

/**
 * Şube alanları (sihirbaz + şube oluşturma/düzenleme ortak). Kontrolsüz girdiler: değerler form
 * gönderiminde FormData'dan okunur. `errors` anahtarları alan adlarıdır (ör. "slug").
 */
export function BranchFields({
  idPrefix,
  defaults,
  options,
  errors = {},
}: {
  idPrefix: string;
  defaults: BranchDefaults;
  /** Sunucuda üretilen seçenek listeleri (bkz. getLocaleOptions). */
  options: LocaleOptions;
  errors?: Record<string, string | undefined>;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const aria = (name: string, hint?: string) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": describedBy(id(name), { hint, error: errors[name] }),
  });

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field id={id("name")} label="Şube adı" required error={errors.name}>
        <Input id={id("name")} name="name" required maxLength={80} defaultValue={defaults.name} {...aria("name")} />
      </Field>
      <Field id={id("slug")} label="Şube kısa adı" required hint="İşletme içinde benzersiz. Örn. merkez, kadikoy" error={errors.slug}>
        <Input id={id("slug")} name="slug" required maxLength={63} defaultValue={defaults.slug} autoCapitalize="none" spellCheck={false} {...aria("slug", "x")} />
      </Field>
      <Field id={id("phone")} label="Telefon" error={errors.phone}>
        <Input id={id("phone")} name="phone" type="tel" inputMode="tel" autoComplete="off" maxLength={24} defaultValue={defaults.phone ?? ""} placeholder="+90 212 000 00 00" {...aria("phone")} />
      </Field>
      <Field id={id("email")} label="E-posta" error={errors.email}>
        <Input id={id("email")} name="email" type="email" maxLength={254} defaultValue={defaults.email ?? ""} {...aria("email")} />
      </Field>
      <Field id={id("country")} label="Ülke" required error={errors.country}>
        <Select id={id("country")} name="country" defaultValue={defaults.country ?? "TR"} {...aria("country")}>
          {options.countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={id("city")} label="Şehir" error={errors.city}>
        <Input id={id("city")} name="city" maxLength={80} defaultValue={defaults.city ?? ""} {...aria("city")} />
      </Field>
      <Field id={id("district")} label="İlçe" error={errors.district}>
        <Input id={id("district")} name="district" maxLength={80} defaultValue={defaults.district ?? ""} {...aria("district")} />
      </Field>
      <Field id={id("address")} label="Adres" error={errors.address} className="md:col-span-2">
        <Textarea id={id("address")} name="address" rows={2} maxLength={300} defaultValue={defaults.address ?? ""} {...aria("address")} />
      </Field>
      <Field id={id("timezone")} label="Saat dilimi" required error={errors.timezone}>
        <Select id={id("timezone")} name="timezone" defaultValue={defaults.timezone ?? "Europe/Istanbul"} {...aria("timezone")}>
          {options.timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={id("currency")} label="Para birimi" required error={errors.currency}>
        <Select id={id("currency")} name="currency" defaultValue={defaults.currency ?? "TRY"} {...aria("currency")}>
          {options.currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={id("locale")} label="Dil" required error={errors.locale}>
        <Select id={id("locale")} name="locale" defaultValue={defaults.locale ?? "tr"} {...aria("locale")}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l] ?? l} ({l})
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function branchFormValues(formData: FormData) {
  const get = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : "";
  };
  return {
    name: get("name"),
    slug: get("slug"),
    phone: get("phone"),
    email: get("email"),
    country: get("country"),
    city: get("city"),
    district: get("district"),
    address: get("address"),
    timezone: get("timezone"),
    currency: get("currency"),
    locale: get("locale"),
  };
}
