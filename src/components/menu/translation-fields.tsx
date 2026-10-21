import { Languages } from "lucide-react";
import { MENU_LOCALE_LABELS, textDirection } from "@/config/menu";
import { cn } from "@/lib/utils/cn";
import { controlBase } from "@/components/ui/field";

export type TranslationValues = Record<string, Record<string, string | null | undefined>>;
export type TranslationFieldDef = { key: string; label: string; multiline?: boolean; maxLength?: number };

/**
 * Çeviri girişleri — kanonik içerik (varsayılan dil) ana alanlardadır; burada yalnızca diğer diller.
 * Alan adları `t.<dil>.<alan>`; Arapça gibi sağdan sola diller `dir="rtl"` + `lang` ile gösterilir
 * (tarayıcı metni doğru yönde hizalar; düzen mantıksal özelliklerle (text-start) RTL'e hazırdır).
 * Ad boş bırakılırsa o dilin çevirisi silinir ve menü varsayılan dile düşer.
 */
export function TranslationFields({
  idPrefix,
  locales,
  fields,
  values,
  errors,
  compact,
}: {
  idPrefix: string;
  locales: readonly string[];
  fields: readonly TranslationFieldDef[];
  values: TranslationValues;
  errors?: Record<string, string>;
  compact?: boolean;
}) {
  if (locales.length === 0) return null;
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 flex items-center gap-2 text-sm font-medium text-fg">
        <Languages aria-hidden="true" className="size-4 text-fg-subtle" /> Çeviriler
      </legend>
      <div className={cn("grid gap-3", !compact && "lg:grid-cols-3")}>
        {locales.map((locale) => {
          const dir = textDirection(locale);
          return (
            <div key={locale} className="grid content-start gap-2 rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center justify-between text-xs font-medium text-fg-subtle">
                <span>{MENU_LOCALE_LABELS[locale] ?? locale}</span>
                <span className="font-mono uppercase">{locale}</span>
              </div>
              {fields.map((field) => {
                const id = `${idPrefix}-${locale}-${field.key}`;
                const name = `t.${locale}.${field.key}`;
                const error = errors?.[`translations.${locale}.${field.key}`];
                const common = {
                  id,
                  name,
                  dir,
                  lang: locale,
                  maxLength: field.maxLength,
                  defaultValue: values[locale]?.[field.key] ?? "",
                  "aria-invalid": error ? true : undefined,
                  "aria-describedby": error ? `${id}-error` : undefined,
                  className: cn(controlBase, "px-3 text-start", field.multiline ? "min-h-20 resize-y py-2 leading-relaxed" : "h-10"),
                };
                return (
                  <div key={field.key} className="grid gap-1">
                    <label htmlFor={id} className="text-[0.8125rem] text-fg-muted">
                      {field.label}
                    </label>
                    {field.multiline ? <textarea rows={3} {...common} /> : <input {...common} />}
                    {error ? (
                      <p id={`${id}-error`} className="text-xs text-danger">
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Çeviri satırlarını { dil: { alan: değer } } biçimine çevirir. */
export function toTranslationValues(rows: readonly ({ locale: string } & Record<string, unknown>)[]): TranslationValues {
  const out: TranslationValues = {};
  for (const row of rows) {
    const values: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(row)) if (key !== "locale" && (typeof value === "string" || value === null)) values[key] = value;
    out[row.locale] = values;
  }
  return out;
}
