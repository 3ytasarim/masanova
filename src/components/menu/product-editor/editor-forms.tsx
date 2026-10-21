"use client";

import { type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { NameSlugFields } from "@/components/menu/name-slug-fields";
import { TranslationFields, type TranslationValues } from "@/components/menu/translation-fields";
import { useUnsavedChanges } from "@/components/menu/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/**
 * Editör formu iskeleti: kaydetme geri bildirimi (toast), kaydedilmemiş değişiklik uyarısı, salt okunur mod
 * (fieldset disabled) ve hata özeti. Her sekme kendi formunu ayrı kaydeder — tek dev form yok.
 */
export function EditorForm({
  action,
  readOnly,
  submitLabel = "Kaydet",
  children,
}: {
  action: FormAction;
  readOnly: boolean;
  submitLabel?: string;
  children: (state: ActionResult | null) => ReactNode;
}) {
  const toast = useToast();
  const { dirty, markDirty, markClean } = useUnsavedChanges();
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) {
      markClean();
      toast(result.message ?? "Kaydedildi.", "success");
    }
    return result;
  }, null);

  return (
    <form onSubmit={onSubmit} noValidate onChange={markDirty} className="grid gap-5">
      <FormAlert state={state} />
      <fieldset disabled={readOnly} className="grid min-w-0 gap-5">
        {children(state)}
      </fieldset>
      {!readOnly ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
          {dirty ? (
            <p className="text-sm text-warning sm:mr-auto" role="status">
              Kaydedilmemiş değişiklikler var.
            </p>
          ) : null}
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function GeneralForm({
  action,
  readOnly,
  product,
  categories,
}: {
  action: FormAction;
  readOnly: boolean;
  product: {
    name: string;
    slug: string;
    categoryId: string;
    shortDescription: string;
    description: string;
    sku: string;
    preparationMinutes: string;
    featured: boolean;
    active: boolean;
    soldOut: boolean;
  };
  categories: { value: string; label: string }[];
}) {
  return (
    <EditorForm action={action} readOnly={readOnly}>
      {(state) => {
        const err = (k: string) => fieldError(state, k);
        return (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              <NameSlugFields idPrefix="pg" nameLabel="Ürün adı" defaultName={product.name} defaultSlug={product.slug} errors={{ name: err("name"), slug: err("slug") }} />
              <Field id="pg-category" label="Kategori" required error={err("categoryId")}>
                <Select id="pg-category" name="categoryId" defaultValue={product.categoryId}>
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-5">
                <Field id="pg-prep" label="Hazırlık (dk)" error={err("preparationMinutes")}>
                  <Input id="pg-prep" name="preparationMinutes" inputMode="numeric" defaultValue={product.preparationMinutes} aria-describedby={describedBy("pg-prep", { error: err("preparationMinutes") })} />
                </Field>
                <Field id="pg-sku" label="SKU / stok kodu" error={err("sku")}>
                  <Input id="pg-sku" name="sku" maxLength={64} defaultValue={product.sku} />
                </Field>
              </div>
            </div>
            <Field id="pg-short" label="Kısa açıklama" hint="Menüde adın altında (en fazla 280 karakter)." error={err("shortDescription")}>
              <Textarea id="pg-short" name="shortDescription" rows={2} maxLength={280} defaultValue={product.shortDescription} aria-describedby={describedBy("pg-short", { hint: true, error: err("shortDescription") })} />
            </Field>
            <Field
              id="pg-desc"
              label="Açıklama"
              hint="Ürün detayında görünür (en fazla 4000 karakter). Paragraflar için boş satır bırakın."
              error={err("description")}
            >
              <Textarea id="pg-desc" name="description" rows={6} maxLength={4000} defaultValue={product.description} aria-describedby={describedBy("pg-desc", { hint: true, error: err("description") })} />
            </Field>
            <div className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-3">
              <Switch id="pg-active" name="active" label="Aktif" description="Pasif ürün menüde görünmez." defaultChecked={product.active} />
              <Switch id="pg-soldout" name="soldOut" label="Tükendi" description="Görünür ama sipariş edilemez." defaultChecked={product.soldOut} />
              <Switch id="pg-featured" name="featured" label="Öne çıkan" description="Menüde vurgulanır." defaultChecked={product.featured} />
            </div>
          </>
        );
      }}
    </EditorForm>
  );
}

export function PricingForm({
  action,
  readOnly,
  basePrice,
  currency,
  currencies,
}: {
  action: FormAction;
  readOnly: boolean;
  basePrice: string;
  currency: string;
  currencies: readonly string[];
}) {
  return (
    <EditorForm action={action} readOnly={readOnly} submitLabel="Fiyatı kaydet">
      {(state) => {
        const err = (k: string) => fieldError(state, k);
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="pp-price" label="Taban fiyat" required hint="Kuruş hassasiyetinde, ör. 89,90" error={err("basePrice")}>
              <Input id="pp-price" name="basePrice" inputMode="decimal" defaultValue={basePrice} aria-invalid={err("basePrice") ? true : undefined} aria-describedby={describedBy("pp-price", { hint: true, error: err("basePrice") })} />
            </Field>
            <Field id="pp-currency" label="Para birimi" error={err("currency")}>
              <Select id="pp-currency" name="currency" defaultValue={currency}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        );
      }}
    </EditorForm>
  );
}

export function ProductTranslationsForm({
  action,
  readOnly,
  locales,
  values,
  canonical,
}: {
  action: FormAction;
  readOnly: boolean;
  locales: string[];
  values: TranslationValues;
  canonical: { locale: string; name: string };
}) {
  return (
    <EditorForm action={action} readOnly={readOnly} submitLabel="Çevirileri kaydet">
      {(state) => (
        <>
          <p className="text-sm text-fg-muted">
            Ana içerik <strong className="font-medium text-fg">{canonical.locale.toUpperCase()}</strong> dilindedir (“{canonical.name}”). Boş bırakılan diller menüde
            ana dile düşer. Otomatik (AI) çeviri sonraki sprintte.
          </p>
          <TranslationFields
            idPrefix="pt"
            locales={locales}
            values={values}
            errors={state && !state.ok ? state.fieldErrors : undefined}
            fields={[
              { key: "name", label: "Ad", maxLength: 120 },
              { key: "shortDescription", label: "Kısa açıklama", multiline: true, maxLength: 280 },
              { key: "description", label: "Açıklama", multiline: true, maxLength: 4000 },
            ]}
          />
        </>
      )}
    </EditorForm>
  );
}

export function ContentForm({
  action,
  readOnly,
  ingredients,
  allergens,
  dietaryTags,
  selected,
  nutrition,
  allergensConfirmed,
}: {
  action: FormAction;
  readOnly: boolean;
  ingredients: { id: string; name: string; active: boolean }[];
  allergens: { id: string; name: string; custom: boolean }[];
  dietaryTags: { id: string; name: string; code: string; custom: boolean }[];
  selected: { ingredientIds: string[]; allergenIds: string[]; dietaryTagIds: string[] };
  nutrition: { calories: string; proteinGrams: string; carbohydrateGrams: string; fatGrams: string };
  allergensConfirmed: boolean;
}) {
  const checkboxGrid = (name: string, items: { id: string; name: string; note?: string }[], chosen: string[], legend: string, help?: ReactNode) => (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-fg">{legend}</legend>
      {help ? <p className="text-[0.8125rem] text-fg-subtle">{help}</p> : null}
      {items.length === 0 ? (
        <p className="text-sm text-fg-subtle">Kayıt yok — “Malzeme & Alerjen” sekmesinden ekleyebilirsiniz.</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <label key={item.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 text-sm hover:bg-surface has-[:checked]:border-fg has-[:checked]:bg-surface">
              <input type="checkbox" name={name} value={item.id} defaultChecked={chosen.includes(item.id)} className="size-4 accent-primary" />
              <span>{item.name}</span>
              {item.note ? <span className="ml-auto text-xs text-fg-subtle">{item.note}</span> : null}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );

  return (
    <EditorForm action={action} readOnly={readOnly} submitLabel="İçeriği kaydet">
      {(state) => {
        const err = (k: string) => fieldError(state, k);
        return (
          <>
            {checkboxGrid(
              "allergenIds",
              allergens.map((a) => ({ id: a.id, name: a.name, note: a.custom ? "özel" : undefined })),
              selected.allergenIds,
              "Alerjenler",
              "Ürünün içerdiği alerjenleri işaretleyin. Bu bilgi işletme beyanıdır.",
            )}
            <Checkbox
              id="pc-allergens-confirmed"
              name="allergensConfirmed"
              label="Alerjen bilgisi girildi"
              description="Hiçbir alerjen içermiyorsa bunu işaretleyin; aksi halde ürün “alerjen bilgisi eksik” olarak görünür."
              defaultChecked={allergensConfirmed}
            />
            {checkboxGrid(
              "dietaryTagIds",
              dietaryTags.map((t) => ({ id: t.id, name: t.name, note: t.custom ? "özel" : undefined })),
              selected.dietaryTagIds,
              "Diyet ve menü etiketleri",
              <>
                Etiketleri yalnızca işletmeniz açıkça beyan ediyorsa atayın. MasaNova hiçbir etiketi otomatik çıkarmaz;{" "}
                <strong className="font-medium">“Helal”</strong> gibi etiketler sertifika anlamına gelmez, işletme beyanı olarak gösterilir.
              </>,
            )}
            {checkboxGrid(
              "ingredientIds",
              ingredients.map((i) => ({ id: i.id, name: i.name, note: i.active ? undefined : "pasif" })),
              selected.ingredientIds,
              "Malzemeler",
              "Müşteriye ve gelecekteki AI asistana gösterilecek içerik bilgisi (reçete/maliyet değildir).",
            )}
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-fg">Besin değerleri (porsiyon başına, isteğe bağlı)</legend>
              <p className="text-[0.8125rem] text-fg-subtle">İşletme tarafından sağlanan bilgidir; tam sayı girin.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ["calories", "Kalori (kcal)"],
                    ["proteinGrams", "Protein (g)"],
                    ["carbohydrateGrams", "Karbonhidrat (g)"],
                    ["fatGrams", "Yağ (g)"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} id={`pc-${key}`} label={label} error={err(key)}>
                    <Input id={`pc-${key}`} name={key} inputMode="numeric" defaultValue={nutrition[key]} aria-describedby={describedBy(`pc-${key}`, { error: err(key) })} />
                  </Field>
                ))}
              </div>
            </fieldset>
          </>
        );
      }}
    </EditorForm>
  );
}
