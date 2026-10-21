import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Veri tablosu. md altında satırlar karta dönüşür (globals.css › .mn-table); her <TD>'ye `label`
 * verilerek mobil görünümde hücre başlığı gösterilir. Orta genişlikte (md–lg) geniş tablolar kendi çerçevesi içinde
 * yatay kaydırılır; sayfa asla taşmaz (`relative`: konumlandırılmış alt öğeler de çerçevede kalır).
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="mn-glass relative w-full overflow-x-auto rounded-2xl">
      <table className={cn("mn-table w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-white/50", className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child]:border-b-0", className)} {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-stone-900/[0.06] transition-colors hover:bg-white/60", className)} {...props} />;
}

export function TH({ className, scope = "col", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn("h-10 border-b border-stone-900/[0.06] px-4 text-left text-xs font-medium uppercase tracking-wide text-fg-subtle", className)}
      {...props}
    />
  );
}

export function TD({ className, label, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { label?: string }) {
  return <td data-label={label} className={cn("px-4 py-3 align-middle text-fg-muted", className)} {...props} />;
}
