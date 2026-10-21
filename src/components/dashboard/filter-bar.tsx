import { Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Liste filtreleri: düz GET formu (JavaScript olmadan da çalışır, URL paylaşılabilir, sunucu tarafı filtreleme).
 */
export function FilterBar({
  action,
  query,
  searchPlaceholder,
  searchLabel = "Ara",
  children,
  hasFilters,
}: {
  action: string;
  query?: string;
  searchPlaceholder: string;
  searchLabel?: string;
  children?: ReactNode;
  hasFilters: boolean;
}) {
  return (
    <form action={action} method="get" role="search" className="mb-4 grid gap-3 rounded-lg border border-border bg-bg p-3 shadow-xs">
      {/* Arama + düğmeler tek satır; filtreler sayısından bağımsız olarak alttaki ızgarada sarılır (taşma yok). */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="filter-q" className="sr-only">
            {searchLabel}
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-md border border-border-strong bg-bg pl-9 pr-3 text-[0.9375rem] placeholder:text-fg-subtle focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1 sm:flex-none">
            Filtrele
          </Button>
          {hasFilters ? (
            <Link href={action} className={buttonVariants({ variant: "ghost", className: "flex-1 sm:flex-none" })}>
              Temizle
            </Link>
          ) : null}
        </div>
      </div>
      {children ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">{children}</div> : null}
    </form>
  );
}

/** Filtre çubuğu içindeki etiketli küçük select. */
export function FilterSelect({
  id,
  name,
  label,
  value,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="text-xs font-medium text-fg-subtle">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value ?? ""}
        className="h-11 w-full min-w-0 rounded-md border border-border-strong bg-bg px-3 text-sm focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
