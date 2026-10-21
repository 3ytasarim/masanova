"use client";

import Link from "next/link";
import { createProductAction } from "@/server/actions/menu.actions";
import { NameSlugFields } from "@/components/menu/name-slug-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Hızlı oluşturma: temel bilgiler → kayıt → zengin editöre yönlendirme (varyant, ekstra, içerik, çeviri). */
export function ProductCreateForm({
  categories,
  currency,
  defaultCategoryId,
}: {
  categories: { value: string; label: string }[];
  currency: string;
  defaultCategoryId?: string;
}) {
  const { state, pending, onSubmit } = useFormAction(createProductAction, null);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <FormAlert state={state} />
      <div className="grid gap-5 md:grid-cols-2">
        <NameSlugFields idPrefix="np" nameLabel="Ürün adı" errors={{ name: err("name"), slug: err("slug") }} />
        <Field id="np-category" label="Kategori" required error={err("categoryId")}>
          <Select id="np-category" name="categoryId" defaultValue={defaultCategoryId ?? categories[0]?.value} aria-describedby={describedBy("np-category", { error: err("categoryId") })}>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="np-price" label={`Taban fiyat (${currency})`} required hint="Ör. 89,90 — varyant fiyatları ayrıca girilebilir." error={err("basePrice")}>
          <Input id="np-price" name="basePrice" inputMode="decimal" placeholder="0,00" required aria-invalid={err("basePrice") ? true : undefined} aria-describedby={describedBy("np-price", { hint: true, error: err("basePrice") })} />
        </Field>
        <Field id="np-short" label="Kısa açıklama" hint="Menüde ürün adının altında görünür (en fazla 280 karakter)." error={err("shortDescription")} className="md:col-span-2">
          <Textarea id="np-short" name="shortDescription" rows={2} maxLength={280} aria-describedby={describedBy("np-short", { hint: true, error: err("shortDescription") })} />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Link href="/panel/menu/urunler" className={buttonVariants({ variant: "secondary" })}>
          Vazgeç
        </Link>
        <Button type="submit" loading={pending}>
          Ürünü oluştur ve düzenle
        </Button>
      </div>
    </form>
  );
}
