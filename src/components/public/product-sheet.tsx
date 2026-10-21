"use client";

import { AlertTriangle, Check, Clock, Info, Minus, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ORDER_LIMITS, calculateLine, defaultVariantRef, type LineIssue } from "@/lib/orders/calculate";
import { toCatalogProduct } from "@/lib/public-menu/catalog";
import type { PublicStrings } from "@/lib/public-menu/i18n";
import type { OrderStrings } from "@/lib/public-menu/i18n-order";
import type { PublicMenuStyleKey, PublicProductView } from "@/lib/public-menu/types";
import { cn } from "@/lib/utils/cn";
import { ProductImage } from "@/components/public/product-image";

/**
 * Ürün detayı + yapılandırıcı — telefonda alttan açılan sayfa, geniş ekranda ortalanmış pencere (yerel <dialog>).
 * Sipariş açıksa (gerçek QR masa bağlamı): varyant, ekstra (en az / en fazla kuralı), adet, ürün notu ve "Sepete ekle".
 * Fiyat önizlemesi merkezi hesaplayıcıyla (calculateLine) yapılır — yalnızca UX; sunucu gönderimde yeniden hesaplar.
 * Sipariş kapalıysa (panel önizlemesi) seçenekler incelenebilir, sepet düğmesi yoktur.
 */
export type ConfiguredLine = {
  product: string;
  variant: string | null;
  modifiers: { group: string; modifier: string }[];
  quantity: number;
  note: string | null;
  unitPriceMinor: number;
  name: string;
  detail: string;
};

export type SheetOrdering = {
  o: OrderStrings;
  money: (minor: number) => string;
  /** Düzenlenen sepet satırı (yoksa yeni ekleme). */
  edit: { key: string; variant: string | null; modifiers: { group: string; modifier: string }[]; quantity: number; note: string | null } | null;
  onSubmit: (line: ConfiguredLine, editKey: string | null) => void;
};

export function ProductSheet({
  product,
  style,
  t,
  allergenNoticeVisible,
  ordering,
  onClose,
}: {
  product: PublicProductView | null;
  style: PublicMenuStyleKey;
  t: PublicStrings;
  allergenNoticeVisible: boolean;
  ordering: SheetOrdering | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (product && !dialog.open) {
      document.querySelectorAll("dialog[open]").forEach((other) => other !== dialog && (other as HTMLDialogElement).close());
      dialog.showModal();
    }
    if (!product && dialog.open) dialog.close();
  }, [product]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      aria-labelledby="pm-sheet-title"
      className={cn(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[1.75rem] bg-[#faf8f5] p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45 backdrop:backdrop-blur-[2px]",
        "sm:m-auto sm:max-h-[88dvh] sm:max-w-xl sm:rounded-[1.75rem]",
        "open:motion-safe:animate-[pm-sheet-in_260ms_cubic-bezier(0.16,1,0.3,1)]",
      )}
    >
      {product ? (
        <SheetBody
          key={`${product.key}:${ordering?.edit?.key ?? "new"}`}
          product={product}
          style={style}
          t={t}
          allergenNoticeVisible={allergenNoticeVisible}
          ordering={ordering}
          onClose={() => ref.current?.close()}
        />
      ) : null}
    </dialog>
  );
}

function SheetBody({
  product,
  style,
  t,
  allergenNoticeVisible,
  ordering,
  onClose,
}: {
  product: PublicProductView;
  style: PublicMenuStyleKey;
  t: PublicStrings;
  allergenNoticeVisible: boolean;
  ordering: SheetOrdering | null;
  onClose: () => void;
}) {
  const catalog = toCatalogProduct(product);
  const edit = ordering?.edit ?? null;
  const [variant, setVariant] = useState<string | null>(edit ? edit.variant : defaultVariantRef(catalog));
  const [picked, setPicked] = useState<{ group: string; modifier: string }[]>(edit?.modifiers ?? []);
  const [quantity, setQuantity] = useState(edit?.quantity ?? 1);
  const [note, setNote] = useState(edit?.note ?? "");
  const [touched, setTouched] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  const noteId = useId();
  const images = product.images.filter((i) => !missing.has(i.url));
  const nutrition = product.nutrition;
  const o = ordering?.o ?? null;

  const line = calculateLine(catalog, { product: product.key, variant, modifiers: picked, quantity, note: note.trim() || null });
  const issueFor = (code: LineIssue["code"], group?: string) => line.issues.find((i) => i.code === code && (!group || ("group" in i && i.group === group)));
  const blocking = line.issues.length > 0;
  const shownPrice = ordering ? ordering.money(line.unitPriceMinor) : product.variants.length ? (product.variants.find((v) => v.ref === variant)?.priceLabel ?? product.priceLabel) : product.priceLabel;

  const toggle = (groupRef: string, modifierRef: string, max: number) => {
    setPicked((current) => {
      const exists = current.some((p) => p.group === groupRef && p.modifier === modifierRef);
      if (exists) return current.filter((p) => !(p.group === groupRef && p.modifier === modifierRef));
      if (max === 1) return [...current.filter((p) => p.group !== groupRef), { group: groupRef, modifier: modifierRef }];
      if (current.filter((p) => p.group === groupRef).length >= max) return current;
      return [...current, { group: groupRef, modifier: modifierRef }];
    });
  };

  const submit = () => {
    setTouched(true);
    if (!ordering || blocking) return;
    const detail = [line.variant?.name, ...line.modifiers.map((m) => m.modifier.name)].filter(Boolean).join(" · ");
    ordering.onSubmit({ product: product.key, variant, modifiers: picked, quantity, note: note.trim() || null, unitPriceMinor: line.unitPriceMinor, name: product.name, detail }, edit?.key ?? null);
    onClose();
  };

  return (
    <div className="flex max-h-[92dvh] flex-col sm:max-h-[88dvh]">
      <div className="relative shrink-0">
        {images.length ? (
          <div className="flex aspect-[4/3] max-h-[34dvh] w-full snap-x snap-mandatory overflow-x-auto bg-stone-100 [scrollbar-width:none] sm:aspect-[16/9]" aria-label={product.name}>
            {images.map((img, i) => (
              <div key={img.url} className="relative h-full w-full shrink-0 snap-center">
                <ProductImage
                  src={img.url}
                  srcSet={img.srcSet}
                  alt={img.alt ?? (i === 0 ? product.name : "")}
                  priority={i === 0}
                  sizes="(min-width: 640px) 576px, 100vw"
                  onMissing={() => setMissing((m) => new Set(m).add(img.url))}
                  className={cn(product.soldOut && "grayscale")}
                />
              </div>
            ))}
          </div>
        ) : (
          // Görsel yoksa kapat düğmesi başlığın üstüne binmesin diye ayrı bir üst şerit.
          <div aria-hidden="true" className="h-16" />
        )}
        <div aria-hidden="true" className="absolute inset-x-0 top-2 flex justify-center sm:hidden">
          <span className="h-1.5 w-10 rounded-full bg-white/80 shadow-sm ring-1 ring-black/10" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-full bg-white/95 text-stone-900 shadow-md ring-1 ring-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]"
        >
          <X aria-hidden="true" className="size-5" />
          <span className="sr-only">{t.close}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id="pm-sheet-title" className={cn("min-w-0 break-words text-[1.5rem] leading-tight text-balance", style === "LUXURY" ? "font-[family-name:var(--font-display-serif)] font-medium" : "font-semibold tracking-tight")}>
            {product.name}
          </h2>
          <p className={cn("mt-1 whitespace-nowrap text-[1.125rem] font-semibold tabular-nums", product.soldOut && "text-stone-400 line-through")} aria-live="polite" data-testid="sheet-price">
            {shownPrice}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {product.soldOut ? <span className="rounded-full bg-stone-900 px-2.5 py-1 text-xs font-semibold text-white">{t.soldOut}</span> : null}
          {product.preparationMinutes ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
              <Clock aria-hidden="true" className="size-3.5" /> {t.prep(product.preparationMinutes)}
            </span>
          ) : null}
          {product.dietaryTags.map((tag) => (
            <span key={tag.code} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
              {tag.name}
            </span>
          ))}
        </div>
        {product.description || product.shortDescription ? <p className="mt-4 text-[0.9375rem] leading-relaxed text-stone-600">{product.description ?? product.shortDescription}</p> : null}

        {product.variants.length ? (
          <Section title={t.variants} error={touched && o && issueFor("variant_required") ? o.chooseVariant : null}>
            <div role="radiogroup" aria-label={t.variants} className="grid gap-2">
              {product.variants.map((v) => {
                const checked = variant === v.ref;
                return (
                  <button
                    key={v.ref}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setVariant(v.ref)}
                    className={cn(
                      "flex min-h-12 items-center justify-between gap-3 rounded-xl px-4 text-start text-[0.9375rem] ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]",
                      checked ? "bg-white font-semibold ring-stone-900" : "bg-white/60 ring-stone-200",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full ring-1", checked ? "ring-stone-900" : "ring-stone-300")}>
                        {checked ? <span className="size-2 rounded-full bg-stone-900" /> : null}
                      </span>
                      <span className="min-w-0 break-words">{v.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{v.priceLabel}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        ) : null}

        {product.modifierGroups.map((group) => {
          const count = picked.filter((p) => p.group === group.ref).length;
          const single = group.maxSelect === 1;
          const min = group.required ? Math.max(1, group.minSelect) : group.minSelect;
          const err = touched && o ? (issueFor("group_min", group.name) ? o.chooseGroup(group.name, min) : issueFor("group_max", group.name) ? o.tooMany(group.name, group.maxSelect) : null) : null;
          return (
            <Section key={group.ref} title={group.name} aside={`${group.required ? t.required : t.optional} · ${t.rule(group.minSelect, group.maxSelect)}`} error={err}>
              <div role={single ? "radiogroup" : "group"} aria-label={group.name} className="divide-y divide-stone-200/70 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">
                {group.modifiers.map((m) => {
                  const checked = picked.some((p) => p.group === group.ref && p.modifier === m.ref);
                  const disabled = !checked && !single && count >= group.maxSelect;
                  return (
                    <button
                      key={m.ref}
                      type="button"
                      role={single ? "radio" : "checkbox"}
                      aria-checked={checked}
                      disabled={disabled}
                      onClick={() => toggle(group.ref, m.ref, group.maxSelect)}
                      className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-[0.9375rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--pm-accent)] disabled:opacity-45"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className={cn("inline-flex size-[1.125rem] shrink-0 items-center justify-center ring-1", single ? "rounded-full" : "rounded-md", checked ? "bg-stone-900 ring-stone-900 text-white" : "ring-stone-300")}>
                          {checked ? single ? <span className="size-2 rounded-full bg-white" /> : <Check className="size-3" /> : null}
                        </span>
                        <span className="min-w-0 break-words">{m.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-stone-500">{m.priceDeltaLabel ?? ""}</span>
                    </button>
                  );
                })}
              </div>
            </Section>
          );
        })}

        {ordering && !product.soldOut ? (
          <section className="mt-6">
            <label htmlFor={noteId} className="mb-2 block text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-stone-500">
              {ordering.o.itemNote}
            </label>
            <textarea
              id={noteId}
              value={note}
              maxLength={ORDER_LIMITS.itemNoteMax}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              placeholder={ordering.o.itemNotePlaceholder}
              aria-describedby={`${noteId}-hint`}
              className="w-full resize-none rounded-xl bg-white px-3.5 py-3 text-[1rem] ring-1 ring-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[var(--pm-accent)]"
            />
            <p id={`${noteId}-hint`} className="mt-1.5 text-xs text-stone-500">
              {ordering.o.itemNoteHint}
            </p>
          </section>
        ) : null}

        {product.ingredients.length ? (
          <Section title={t.ingredients}>
            <p className="text-[0.9375rem] leading-relaxed text-stone-700">{product.ingredients.join(", ")}</p>
          </Section>
        ) : null}

        {allergenNoticeVisible ? (
          <Section title={t.allergens}>
            {product.allergens.length ? (
              <ul className="flex flex-wrap gap-2">
                {product.allergens.map((a) => (
                  <li key={a.code} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
                    <AlertTriangle aria-hidden="true" className="size-3.5" /> {a.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-600">{product.allergenInfoDeclared ? t.allergenNone : t.allergenUnknown}</p>
            )}
            <AllergenNotice t={t} className="mt-3" />
          </Section>
        ) : null}

        {nutrition ? (
          <Section title={t.nutrition} aside={t.perServing}>
            <dl className="grid grid-cols-4 gap-2 text-center">
              {(
                [
                  [t.calories, nutrition.calories, "kcal"],
                  [t.protein, nutrition.proteinGrams, "g"],
                  [t.carbs, nutrition.carbohydrateGrams, "g"],
                  [t.fat, nutrition.fatGrams, "g"],
                ] as const
              ).map(([label, value, unit]) => (
                <div key={label} className="rounded-xl bg-white px-1 py-2.5 ring-1 ring-stone-200">
                  <dt className="truncate text-[0.6875rem] text-stone-500">{label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value === null ? "—" : `${value} ${unit}`}</dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : null}

        {!ordering ? (
          <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-stone-500">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> {t.viewOnly}
          </p>
        ) : null}
      </div>

      {ordering ? (
        <div className="shrink-0 border-t border-stone-200/80 bg-[#faf8f5] px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3">
          {product.soldOut ? (
            <p className="flex min-h-12 items-center justify-center rounded-full bg-stone-200 text-[0.9375rem] font-semibold text-stone-600">{ordering.o.unavailable}</p>
          ) : (
            <div className="flex items-center gap-3">
              <QuantityStepper value={quantity} onChange={setQuantity} name={product.name} o={ordering.o} />
              <button
                type="button"
                onClick={submit}
                aria-disabled={blocking}
                data-testid="add-to-cart"
                className={cn(
                  "flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-full px-4 text-[0.9375rem] font-semibold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)] focus-visible:ring-offset-2",
                  blocking ? "bg-stone-300 text-stone-600" : "bg-[var(--pm-brand)] text-[var(--pm-on-brand)]",
                )}
              >
                <span className="truncate">{(edit ? ordering.o.updateItem : ordering.o.addToCart)(ordering.money(line.lineTotalMinor))}</span>
              </button>
            </div>
          )}
          {touched && blocking ? (
            <p role="alert" className="mt-2 text-center text-xs font-medium text-red-700">
              {issueFor("variant_required") ? ordering.o.chooseVariant : line.issues.map((i) => ("group" in i ? (i.code === "group_min" ? ordering.o.chooseGroup(i.group, i.min) : ordering.o.tooMany(i.group, i.max)) : null)).find(Boolean) ?? ordering.o.unavailable}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function QuantityStepper({ value, onChange, name, o, small = false }: { value: number; onChange: (n: number) => void; name: string; o: OrderStrings; small?: boolean }) {
  const size = small ? "size-9" : "size-11";
  return (
    <div className={cn("inline-flex shrink-0 items-center rounded-full bg-white ring-1 ring-stone-900/10", small ? "h-9" : "h-12")} role="group" aria-label={`${o.quantity}: ${name}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 1 && !small} className={cn("inline-flex items-center justify-center rounded-full disabled:opacity-35", size)} aria-label={o.decrease(name)}>
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <span className="min-w-6 text-center text-[0.9375rem] font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => onChange(Math.min(ORDER_LIMITS.maxQuantityPerLine, value + 1))} disabled={value >= ORDER_LIMITS.maxQuantityPerLine} className={cn("inline-flex items-center justify-center rounded-full disabled:opacity-35", size)} aria-label={o.increase(name)}>
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

function Section({ title, aside, error, children }: { title: string; aside?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-stone-500">{title}</h3>
        {aside ? <span className="text-end text-xs text-stone-500">{aside}</span> : null}
      </div>
      {error ? (
        <p role="alert" className="mb-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function AllergenNotice({ t, className }: { t: PublicStrings; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-xl bg-stone-100 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-stone-600", className)}>
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {t.allergenNotice}
    </p>
  );
}
