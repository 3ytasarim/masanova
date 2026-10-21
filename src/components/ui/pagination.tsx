import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * Sunucu tarafı sayfalama bağlantıları — mevcut filtreleri (query) korur. Yalnızca bağlantı üretir,
 * istemci JavaScript'i yok.
 */
export function Pagination({
  basePath,
  query,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  query: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    if (p > 1) params.set("sayfa", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkClass =
    "inline-flex h-9 items-center gap-1 rounded-md border border-border-strong bg-bg px-3 text-sm font-medium text-fg-muted hover:bg-surface";
  const disabledClass = "pointer-events-none opacity-40";

  return (
    <nav aria-label="Sayfalama" className="flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row">
      <p className="text-sm text-fg-subtle" aria-live="polite">
        {formatNumber(total)} kayıttan {formatNumber(from)}–{formatNumber(to)} gösteriliyor
      </p>
      <div className="flex items-center gap-2">
        <Link href={href(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} className={cn(linkClass, page <= 1 && disabledClass)}>
          <ChevronLeft aria-hidden="true" className="size-4" /> Önceki
        </Link>
        <span className="text-sm tabular-nums text-fg-subtle">
          {page} / {pages}
        </span>
        <Link href={href(page + 1)} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined} className={cn(linkClass, page >= pages && disabledClass)}>
          Sonraki <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </nav>
  );
}
