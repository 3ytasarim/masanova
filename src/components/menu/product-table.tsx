"use client";

import { ArrowDown, ArrowUp, CircleSlash, Eye, EyeOff, ImageOff, Pencil, RotateCcw, Star, StarOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { bulkProductAction, productQuickAction } from "@/server/actions/menu.actions";
import { QuickAction } from "@/components/menu/quick-action";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";

export type ProductRow = {
  id: string;
  name: string;
  slug: string;
  categoryName: string;
  priceLabel: string;
  active: boolean;
  soldOut: boolean;
  featured: boolean;
  archived: boolean;
  updatedLabel: string;
  imageUrl: string | null;
  imageAlt: string | null;
  issues: string[];
};

const BULK_LABELS = {
  activate: "Aktifleştir",
  deactivate: "Pasifleştir",
  sold_out: "Tükendi işaretle",
  clear_sold_out: "Tükendiyi kaldır",
  feature: "Öne çıkar",
  unfeature: "Öne çıkarmayı kaldır",
} as const;

/**
 * Ürün tablosu: seçim + güvenli toplu işlemler (silme yok) + satır içi hızlı işaretler.
 * Toplu formun onay kutuları `form` özniteliğiyle bağlıdır (satır içi formlar iç içe olmasın diye).
 */
export function ProductTable({ rows, canManage, manualOrder }: { rows: ProductRow[]; canManage: boolean; manualOrder: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useToast();
  const [, bulkAction, bulkPending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await bulkProductAction(prev, fd);
    if (result?.ok) {
      toast(result.message ?? "Güncellendi.", "success");
      setSelected(new Set());
    } else if (result) toast(result.error, "error");
    return result;
  }, null);

  const selectable = rows.filter((r) => !r.archived);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {canManage ? (
        <form
          id="bulk-form"
          action={bulkAction}
          className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center"
          aria-label="Toplu işlemler"
        >
          <p className="text-sm text-fg-muted" aria-live="polite">
            {selected.size > 0 ? `${selected.size} ürün seçildi` : "Toplu işlem için ürün seçin"}
          </p>
          <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
            <label htmlFor="bulk-op" className="sr-only">
              Toplu işlem
            </label>
            <select id="bulk-op" name="op" className="h-9 rounded-md border border-border-strong bg-bg px-2 text-sm" defaultValue="sold_out">
              {Object.entries(BULK_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={selected.size === 0} loading={bulkPending}>
              Uygula
            </Button>
          </div>
        </form>
      ) : null}

      <Table>
        <THead>
          <TR>
            {canManage ? (
              <TH className="w-10">
                <input
                  type="checkbox"
                  aria-label="Tümünü seç"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
                  className="size-4 accent-primary"
                />
              </TH>
            ) : null}
            <TH>Ürün</TH>
            <TH>Kategori</TH>
            <TH className="text-right">Taban fiyat</TH>
            <TH>Durum</TH>
            <TH>Güncellendi</TH>
            <TH><span className="sr-only">İşlemler</span></TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row, index) => (
            <TR key={row.id}>
              {canManage ? (
                <TD label="Seç">
                  {!row.archived ? (
                    <input
                      type="checkbox"
                      name="ids"
                      value={row.id}
                      form="bulk-form"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`${row.name} seç`}
                      className="size-4 accent-primary"
                    />
                  ) : null}
                </TD>
              ) : null}
              <TD label="Ürün">
                <div className="flex items-center gap-3 text-left">
                  <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface">
                    {row.imageUrl ? (
                      <Image src={row.imageUrl} alt={row.imageAlt ?? ""} fill sizes="44px" unoptimized className="object-cover" />
                    ) : (
                      <ImageOff aria-hidden="true" className="size-4 text-fg-subtle" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <Link href={`/panel/menu/urunler/${row.id}`} className="block truncate font-medium text-fg hover:underline">
                      {row.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-fg-subtle">{row.slug}</span>
                      {row.issues.length > 0 ? (
                        <Tooltip content={row.issues.join(" · ")}>
                          <button type="button" className="rounded-sm">
                            <Badge tone="warning">{row.issues.length} eksik</Badge>
                          </button>
                        </Tooltip>
                      ) : (
                        <Badge tone="success">Tam</Badge>
                      )}
                    </span>
                  </span>
                </div>
              </TD>
              <TD label="Kategori">{row.categoryName}</TD>
              <TD label="Taban fiyat" className="text-right tabular-nums text-fg">{row.priceLabel}</TD>
              <TD label="Durum">
                <span className="inline-flex flex-wrap gap-1">
                  {row.archived ? <Badge>Arşivde</Badge> : !row.active ? <Badge>Pasif</Badge> : row.soldOut ? <Badge tone="warning" dot>Tükendi</Badge> : <Badge tone="success" dot>Satışta</Badge>}
                  {row.featured ? <Badge tone="accent">Öne çıkan</Badge> : null}
                </span>
              </TD>
              <TD label="Güncellendi" className="whitespace-nowrap">{row.updatedLabel}</TD>
              <TD label="İşlemler" className="text-right">
                <span className="inline-flex flex-wrap justify-end gap-0.5">
                  {canManage && row.archived ? (
                    <QuickAction action={productQuickAction} fields={{ id: row.id, op: "restore" }} label={`${row.name}: arşivden çıkar`}>
                      <RotateCcw aria-hidden="true" /> <span className="text-xs">Geri al</span>
                    </QuickAction>
                  ) : null}
                  {canManage && !row.archived ? (
                    <>
                      {manualOrder ? (
                        <>
                          <QuickAction action={productQuickAction} fields={{ id: row.id, op: "up" }} label={`${row.name}: yukarı`} disabled={index === 0}>
                            <ArrowUp aria-hidden="true" />
                          </QuickAction>
                          <QuickAction action={productQuickAction} fields={{ id: row.id, op: "down" }} label={`${row.name}: aşağı`} disabled={index === rows.length - 1}>
                            <ArrowDown aria-hidden="true" />
                          </QuickAction>
                        </>
                      ) : null}
                      <QuickAction
                        action={productQuickAction}
                        fields={{ id: row.id, op: "soldOut", value: String(!row.soldOut) }}
                        label={row.soldOut ? `${row.name}: yeniden satışa aç` : `${row.name}: tükendi işaretle`}
                      >
                        <CircleSlash aria-hidden="true" className={row.soldOut ? "text-warning" : undefined} />
                      </QuickAction>
                      <QuickAction
                        action={productQuickAction}
                        fields={{ id: row.id, op: "featured", value: String(!row.featured) }}
                        label={row.featured ? `${row.name}: öne çıkarmayı kaldır` : `${row.name}: öne çıkar`}
                      >
                        {row.featured ? <Star aria-hidden="true" className="fill-current text-accent-strong" /> : <StarOff aria-hidden="true" />}
                      </QuickAction>
                      <QuickAction
                        action={productQuickAction}
                        fields={{ id: row.id, op: "active", value: String(!row.active) }}
                        label={row.active ? `${row.name}: pasifleştir` : `${row.name}: aktifleştir`}
                      >
                        {row.active ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                      </QuickAction>
                    </>
                  ) : null}
                  <Link href={`/panel/menu/urunler/${row.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    <Pencil aria-hidden="true" /> {canManage ? "Düzenle" : "Görüntüle"}
                    <span className="sr-only">: {row.name}</span>
                  </Link>
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
