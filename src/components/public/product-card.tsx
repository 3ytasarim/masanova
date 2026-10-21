"use client";

import { Clock, Star } from "lucide-react";
import { useState } from "react";
import type { PublicStrings } from "@/lib/public-menu/i18n";
import type { PublicMenuStyleKey, PublicProductView } from "@/lib/public-menu/types";
import { cn } from "@/lib/utils/cn";
import { ProductImage } from "@/components/public/product-image";

/**
 * Ürün kartı — dört düzen (COMPACT / VISUAL / LUXURY / MODERN).
 * Erişilebilirlik: kart bir <article>; başlığın içindeki düğme kartın tamamını kaplar ("stretched button"),
 * böylece tek odak durağı + anlamlı başlık hiyerarşisi. Tükenen ürün görünür ama sipariş edilebilir izlenimi
 * vermez (soluk, rozetli, fiyat üstü çizili). Görseli olmayan ürün boş kutu yerine metin odaklı kart olur.
 */
export function ProductCard({
  product,
  style,
  t,
  onOpen,
  priority = false,
}: {
  product: PublicProductView;
  style: PublicMenuStyleKey;
  t: PublicStrings;
  onOpen: (key: string) => void;
  priority?: boolean;
}) {
  const [imageMissing, setImageMissing] = useState(false);
  const image = imageMissing ? null : (product.images[0] ?? null);
  const priceText = product.startingFrom ? t.startingAt(product.priceLabel) : product.priceLabel;

  const price = (
    <span className={cn("whitespace-nowrap font-semibold tabular-nums", product.soldOut ? "text-stone-400 line-through decoration-stone-300" : "text-stone-900")}>
      {priceText}
    </span>
  );

  const title = (className: string) => (
    <h3 className={className}>
      <button
        type="button"
        onClick={() => onOpen(product.key)}
        data-product={product.key}
        className="text-start after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none"
      >
        {product.name}
        <span className="sr-only">
          , {priceText}
          {product.soldOut ? `, ${t.soldOut}` : ""}
        </span>
      </button>
    </h3>
  );

  const meta = (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {product.soldOut ? <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[0.6875rem] font-semibold text-white">{t.soldOut}</span> : null}
      {product.featured && !product.soldOut ? (
        <span className="inline-flex items-center gap-1 text-[0.75rem] font-medium" style={{ color: "var(--pm-accent)" }}>
          <Star aria-hidden="true" className="size-3 fill-current" /> {t.featured}
        </span>
      ) : null}
      {product.dietaryTags.slice(0, 3).map((tag) => (
        <span key={tag.code} className="rounded-full bg-stone-100 px-2 py-0.5 text-[0.6875rem] font-medium text-stone-700">
          {tag.name}
        </span>
      ))}
      {product.preparationMinutes ? (
        <span className="inline-flex items-center gap-1 text-[0.75rem] text-stone-500">
          <Clock aria-hidden="true" className="size-3" /> {t.prep(product.preparationMinutes)}
        </span>
      ) : null}
      {product.allergens.length ? (
        <span className="text-[0.75rem] text-stone-500">
          <span className="sr-only">{t.allergens}: </span>
          {product.allergens
            .slice(0, 3)
            .map((a) => a.name)
            .join(" · ")}
          {product.allergens.length > 3 ? ` +${product.allergens.length - 3}` : ""}
        </span>
      ) : null}
    </div>
  );

  const focusRing = "focus-within:ring-2 focus-within:ring-[var(--pm-accent)]";

  if (style === "VISUAL") {
    return (
      <article
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(28_25_23/0.06),0_8px_24px_-12px_rgb(28_25_23/0.18)] ring-1 ring-stone-900/5 transition-transform duration-200 motion-safe:active:scale-[0.99]",
          focusRing,
          product.soldOut && "opacity-70",
        )}
      >
        {image ? (
          <div className="relative aspect-[16/10] w-full overflow-hidden bg-stone-100">
            <ProductImage src={image.url} srcSet={image.srcSet} alt={image.alt ?? ""} priority={priority} sizes="(min-width: 768px) 50vw, 100vw" onMissing={() => setImageMissing(true)} className={cn(product.soldOut && "grayscale")} />
          </div>
        ) : null}
        <div className="flex flex-1 flex-col p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
            {title("min-w-0 text-[1.0625rem] font-semibold leading-snug text-stone-900")}
            <span className="ms-auto">{price}</span>
          </div>
          {product.shortDescription ? <p className="mt-1 line-clamp-2 text-[0.9375rem] leading-relaxed text-stone-600">{product.shortDescription}</p> : null}
          {meta}
        </div>
      </article>
    );
  }

  if (style === "MODERN") {
    // Koyu cam kart: solda kare görsel, sağda ad + açıklama + fiyat (mobil öncelikli, yatay).
    return (
      <article className={cn("relative flex min-h-[7.5rem] overflow-hidden rounded-2xl bg-stone-900/75 ring-1 ring-white/10 backdrop-blur-sm transition-transform duration-200 motion-safe:active:scale-[0.99]", focusRing, product.soldOut && "opacity-60")}>
        {image ? (
          <div className="relative w-[7.75rem] shrink-0 self-stretch overflow-hidden bg-stone-800 @md:w-36">
            <ProductImage src={image.url} srcSet={image.srcSet} alt={image.alt ?? ""} sizes="144px" priority={priority} onMissing={() => setImageMissing(true)} className={cn(product.soldOut && "grayscale")} />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col p-3.5">
          {title("text-[1rem] font-semibold leading-snug text-white")}
          {product.shortDescription ? <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-stone-400">{product.shortDescription}</p> : null}
          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            <span className="flex min-w-0 flex-wrap gap-1">
              {product.soldOut ? <span className="rounded-full bg-white px-2 py-0.5 text-[0.6875rem] font-semibold text-stone-900">{t.soldOut}</span> : null}
              {product.dietaryTags.slice(0, 2).map((tag) => (
                <span key={tag.code} className="rounded-full bg-white/10 px-2 py-0.5 text-[0.6875rem] font-medium text-stone-300">
                  {tag.name}
                </span>
              ))}
            </span>
            {/* "₺1.000,00'dan başlayan": tutar kalın tek satır, "başlayan" altında küçük (dar ekranda taşma / kelime bölünmesi yok). */}
            <span data-testid="modern-price" className={cn("flex shrink-0 flex-col items-end text-right leading-tight", product.soldOut ? "text-stone-500 line-through" : "text-[var(--pm-modern-title)]")}>
              {(() => {
                const words = priceText.split(" ");
                const i = Math.max(0, words.findIndex((w) => /\d/.test(w)));
                const before = words.slice(0, i).join(" ");
                const after = words.slice(i + 1).join(" ");
                return (
                  <>
                    {before ? <span className="text-[0.6875rem] font-medium text-stone-400">{before} </span> : null}
                    <span className="whitespace-nowrap text-[1.0625rem] font-bold tabular-nums">{words[i]}</span>
                    {after ? <span className="text-[0.6875rem] font-medium text-stone-400"> {after}</span> : null}
                  </>
                );
              })()}
            </span>
          </div>
        </div>
      </article>
    );
  }

  if (style === "LUXURY") {
    return (
      <article className={cn("relative flex items-start gap-4 rounded-lg py-5", focusRing, product.soldOut && "opacity-60")}>
        {image ? (
          <div className="relative size-16 shrink-0 overflow-hidden rounded-full bg-stone-100">
            <ProductImage src={image.url} srcSet={image.srcSet} alt={image.alt ?? ""} sizes="64px" onMissing={() => setImageMissing(true)} className={cn(product.soldOut && "grayscale")} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            {title("font-[family-name:var(--font-display-serif)] text-[1.1875rem] leading-snug text-stone-900")}
            <span aria-hidden="true" className="mb-1 min-w-4 flex-1 border-b border-dotted border-stone-300" />
            {price}
          </div>
          {product.shortDescription ? <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-stone-500">{product.shortDescription}</p> : null}
          {meta}
        </div>
      </article>
    );
  }

  return (
    <article className={cn("relative flex items-start gap-3 rounded-lg py-4", focusRing, product.soldOut && "opacity-70")}>
      <div className="min-w-0 flex-1">
        {title("text-[1rem] font-semibold leading-snug text-stone-900")}
        {product.shortDescription ? <p className="mt-0.5 line-clamp-2 text-[0.875rem] leading-relaxed text-stone-600">{product.shortDescription}</p> : null}
        <p className="mt-1.5">{price}</p>
        {meta}
      </div>
      {image ? (
        <div className="relative size-[5.5rem] shrink-0 overflow-hidden rounded-xl bg-stone-100">
          <ProductImage src={image.url} srcSet={image.srcSet} alt={image.alt ?? ""} sizes="88px" priority={priority} onMissing={() => setImageMissing(true)} className={cn(product.soldOut && "grayscale")} />
        </div>
      ) : null}
    </article>
  );
}
