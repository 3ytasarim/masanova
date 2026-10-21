"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, Pencil, Plus, QrCode, Rows3, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { BULK_TABLE_MAX, DEFAULT_TABLE_PATTERN, formatTableName } from "@/lib/tables/naming";
import { areaQuickAction, bulkCreateTablesAction, createTableAction, saveAreaAction } from "@/server/actions/tables.actions";
import { NameSlugFields } from "@/components/menu/name-slug-fields";
import { QuickAction } from "@/components/menu/quick-action";
import { TableFields } from "@/components/tables/table-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";

export type AreaView = { id: string; name: string; slug: string; description: string | null; active: boolean; tableCount: number };
export type TableView = {
  id: string;
  name: string;
  number: number | null;
  code: string | null;
  capacity: number | null;
  active: boolean;
  areaId: string | null;
  qr: { scanCount: number; lastUsedAt: string | null } | null;
  /** Masada oturan rezervasyon (yalnız ad + kişi). */
  seated?: { guestName: string; partySize: number } | null;
};

type DialogState = { kind: "area"; area: AreaView | null } | { kind: "table"; areaId: string | null } | { kind: "bulk"; areaId: string | null } | null;

export function TablesManager({
  branch,
  areas,
  tables,
  canManage,
  filtered,
  openDialog,
  stats,
  nextNumber,
}: {
  branch: { id: string; name: string; active: boolean };
  areas: AreaView[];
  tables: TableView[];
  canManage: boolean;
  filtered: boolean;
  openDialog: "bolge" | "masa" | "toplu" | null;
  stats: { total: number; withQr: number; shown: number };
  nextNumber: number;
}) {
  const [dialog, setDialog] = useState<DialogState>(
    openDialog === "bolge" ? { kind: "area", area: null } : openDialog === "masa" ? { kind: "table", areaId: null } : openDialog === "toplu" ? { kind: "bulk", areaId: null } : null,
  );
  const byArea = useMemo(() => {
    const map = new Map<string | null, TableView[]>();
    for (const t of tables) map.set(t.areaId, [...(map.get(t.areaId) ?? []), t]);
    return map;
  }, [tables]);
  const unassigned = byArea.get(null) ?? [];
  const visibleAreas = filtered ? areas.filter((a) => (byArea.get(a.id)?.length ?? 0) > 0) : areas;

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-subtle">
          <span className="font-medium text-fg">{branch.name}</span>
          {!branch.active ? " (pasif şube — QR kodları çalışmaz)" : ""} · {stats.total} masa · {stats.withQr} QR kodlu
          {filtered ? ` · ${stats.shown} sonuç` : ""}
        </p>
        {canManage ? (
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "area", area: null })}>
              <LayoutGrid aria-hidden="true" /> Bölge
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "table", areaId: null })}>
              <Plus aria-hidden="true" /> Masa
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: "bulk", areaId: null })}>
              <Rows3 aria-hidden="true" /> Toplu
            </Button>
          </div>
        ) : null}
      </div>

      {areas.length === 0 && tables.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={filtered ? "Sonuç yok" : "Henüz bölge ya da masa yok"}
          description={filtered ? "Filtreleri değiştirin." : "Önce Salon, Bahçe, Teras gibi bir bölge oluşturun; ardından masaları tek tek ya da toplu ekleyin."}
        />
      ) : (
        <div className="grid gap-5">
          {visibleAreas.map((area, i) => (
            <AreaSection
              key={area.id}
              area={area}
              tables={byArea.get(area.id) ?? []}
              canManage={canManage}
              isFirst={i === 0}
              isLast={i === visibleAreas.length - 1}
              reorderable={!filtered}
              onEdit={() => setDialog({ kind: "area", area })}
              onAddTable={() => setDialog({ kind: "table", areaId: area.id })}
              onBulk={() => setDialog({ kind: "bulk", areaId: area.id })}
            />
          ))}
          {unassigned.length > 0 ? (
            <section aria-labelledby="area-none" className="rounded-xl border border-dashed border-border-strong bg-bg">
              <header className="px-4 py-3">
                <h2 id="area-none" className="font-semibold">
                  Bölgesiz masalar <span className="font-normal text-fg-subtle">· {unassigned.length}</span>
                </h2>
              </header>
              <TableGrid tables={unassigned} />
            </section>
          ) : null}
        </div>
      )}

      {dialog?.kind === "area" ? <AreaDialog key={dialog.area?.id ?? "new"} branchId={branch.id} area={dialog.area} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "table" ? <TableCreateDialog branchId={branch.id} areas={areas} defaultAreaId={dialog.areaId} nextNumber={nextNumber} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "bulk" ? <BulkDialog branchId={branch.id} areas={areas} defaultAreaId={dialog.areaId} nextNumber={nextNumber} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function AreaSection({
  area,
  tables,
  canManage,
  isFirst,
  isLast,
  reorderable,
  onEdit,
  onAddTable,
  onBulk,
}: {
  area: AreaView;
  tables: TableView[];
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  reorderable: boolean;
  onEdit: () => void;
  onAddTable: () => void;
  onBulk: () => void;
}) {
  const headingId = `area-${area.id}`;
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-border bg-bg shadow-xs" data-area={area.name}>
      <header className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="font-semibold">
              {area.name}
            </h2>
            <span className="text-sm text-fg-subtle">· {area.tableCount} masa</span>
            {!area.active ? <Badge tone="warning">Pasif — QR kodları çalışmaz</Badge> : null}
          </div>
          {area.description ? <p className="mt-0.5 text-sm text-fg-subtle">{area.description}</p> : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-0.5">
            {reorderable ? (
              <>
                <QuickAction action={areaQuickAction} fields={{ id: area.id, op: "up" }} label={`${area.name}: yukarı taşı`} disabled={isFirst}>
                  <ArrowUp aria-hidden="true" />
                </QuickAction>
                <QuickAction action={areaQuickAction} fields={{ id: area.id, op: "down" }} label={`${area.name}: aşağı taşı`} disabled={isLast}>
                  <ArrowDown aria-hidden="true" />
                </QuickAction>
              </>
            ) : null}
            <QuickAction action={areaQuickAction} fields={{ id: area.id, op: "active", value: String(!area.active) }} label={area.active ? `${area.name}: pasifleştir` : `${area.name}: aktifleştir`}>
              {area.active ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            </QuickAction>
            <Button variant="ghost" size="sm" onClick={onAddTable}>
              <Plus aria-hidden="true" /> Masa<span className="sr-only">: {area.name} bölgesine ekle</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onBulk}>
              <Rows3 aria-hidden="true" /> Toplu<span className="sr-only">: {area.name} bölgesine toplu masa</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil aria-hidden="true" /> Düzenle<span className="sr-only">: {area.name}</span>
            </Button>
          </div>
        ) : null}
      </header>
      {tables.length ? <TableGrid tables={tables} /> : <p className="px-4 py-5 text-sm text-fg-subtle">Bu bölgede masa yok.</p>}
    </section>
  );
}

function TableGrid({ tables }: { tables: TableView[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {tables.map((t) => (
        <li key={t.id}>
          <Link
            href={`/panel/masalar/${t.id}`}
            className="flex h-full min-h-[4.5rem] flex-col justify-between gap-2 rounded-lg border border-border bg-bg p-3 transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-fg">{t.name}</span>
              {t.qr ? (
                <QrCode aria-label="QR kodu var" className="size-4 shrink-0 text-success" />
              ) : (
                <span className="shrink-0 text-[0.6875rem] font-medium text-warning">QR yok</span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
              {!t.active ? <Badge tone="warning">Pasif</Badge> : null}
              {t.seated ? (
                <Badge tone="accent" data-testid="table-seated">
                  Masada: {t.seated.guestName} · {t.seated.partySize} kişi
                </Badge>
              ) : null}
              {t.capacity ? (
                <span className="inline-flex items-center gap-1">
                  <Users aria-hidden="true" className="size-3" />
                  <span className="sr-only">Kapasite</span>
                  {t.capacity}
                </span>
              ) : null}
              {t.qr ? <span>{t.qr.scanCount} okutma</span> : null}
              {t.code ? <span className="font-mono">{t.code}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── Diyaloglar ─────────────────────────────────────────────────────────────

function useDialogAction(action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult | null>, onClose: () => void) {
  const toast = useToast();
  return useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) {
      toast(result.message ?? "Kaydedildi.", "success");
      onClose();
    }
    return result;
  }, null);
}

function DialogButtons({ pending, onClose, submitLabel }: { pending: boolean; onClose: () => void; submitLabel: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onClose} disabled={pending}>
        Vazgeç
      </Button>
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
    </div>
  );
}

function AreaDialog({ branchId, area, onClose }: { branchId: string; area: AreaView | null; onClose: () => void }) {
  const { state, pending, onSubmit } = useDialogAction(saveAreaAction.bind(null, branchId, area?.id ?? null), onClose);
  const err = (k: string) => fieldError(state, k);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={area ? `Bölge: ${area.name}` : "Yeni bölge"} description="Ör. Salon, Bahçe, Teras, VIP, Üst Kat, Bar.">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NameSlugFields idPrefix="area" nameLabel="Bölge adı" defaultName={area?.name} defaultSlug={area?.slug} errors={{ name: err("name"), slug: err("slug") }} />
        </div>
        <Field id="area-description" label="Açıklama" error={err("description")} hint="İsteğe bağlı, yalnızca panelde görünür.">
          <Textarea id="area-description" name="description" rows={2} maxLength={200} defaultValue={area?.description ?? ""} aria-describedby={describedBy("area-description", { hint: true, error: err("description") })} />
        </Field>
        <Checkbox id="area-active" name="active" label="Aktif" description="Pasif bölgedeki masaların QR kodları çalışmaz. Masalar ve QR geçmişi silinmez." defaultChecked={area?.active ?? true} />
        <DialogButtons pending={pending} onClose={onClose} submitLabel={area ? "Kaydet" : "Bölgeyi oluştur"} />
      </form>
    </Dialog>
  );
}

function TableCreateDialog({ branchId, areas, defaultAreaId, nextNumber, onClose }: { branchId: string; areas: AreaView[]; defaultAreaId: string | null; nextNumber: number; onClose: () => void }) {
  const { state, pending, onSubmit } = useDialogAction(createTableAction.bind(null, branchId), onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Yeni masa" className="max-h-[90dvh]">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormAlert state={state} />
        <TableFields
          idPrefix="nt"
          state={state}
          areas={areas}
          defaults={{ name: formatTableName(DEFAULT_TABLE_PATTERN, nextNumber), number: nextNumber, code: null, capacity: null, areaId: defaultAreaId, active: true }}
        />
        <DialogButtons pending={pending} onClose={onClose} submitLabel="Masayı oluştur" />
      </form>
    </Dialog>
  );
}

function BulkDialog({ branchId, areas, defaultAreaId, nextNumber, onClose }: { branchId: string; areas: AreaView[]; defaultAreaId: string | null; nextNumber: number; onClose: () => void }) {
  const { state, pending, onSubmit } = useDialogAction(bulkCreateTablesAction.bind(null, branchId), onClose);
  const err = (k: string) => fieldError(state, k);
  const [count, setCount] = useState("10");
  const [start, setStart] = useState(String(nextNumber));
  const [pattern, setPattern] = useState(DEFAULT_TABLE_PATTERN);
  const n = Number(count);
  const s = Number(start);
  const valid = Number.isInteger(n) && n >= 1 && n <= BULK_TABLE_MAX && Number.isInteger(s) && s >= 1 && pattern.trim() !== "";
  const preview = valid ? (n <= 3 ? Array.from({ length: n }, (_, i) => formatTableName(pattern, s + i)).join(", ") : `${formatTableName(pattern, s)}, ${formatTableName(pattern, s + 1)} … ${formatTableName(pattern, s + n - 1)}`) : "—";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Toplu masa oluştur" description="Tüm masalar tek işlemde oluşturulur; çakışan ad ya da numara varsa hiçbiri oluşturulmaz." className="max-h-[90dvh]">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormAlert state={state} />
        <Field id="bulk-area" label="Bölge" error={err("diningAreaId")}>
          <Select id="bulk-area" name="diningAreaId" defaultValue={defaultAreaId ?? ""}>
            <option value="">— Bölgesiz —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="bulk-count" label="Adet" required error={err("count")} hint={`En fazla ${BULK_TABLE_MAX}`}>
            <Input id="bulk-count" name="count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-describedby={describedBy("bulk-count", { hint: true, error: err("count") })} />
          </Field>
          <Field id="bulk-start" label="Başlangıç numarası" required error={err("startNumber")}>
            <Input id="bulk-start" name="startNumber" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} aria-describedby={describedBy("bulk-start", { error: err("startNumber") })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field id="bulk-pattern" label="Ad kalıbı" required error={err("pattern")} hint="{n} numarayla değişir">
            <Input id="bulk-pattern" name="pattern" value={pattern} maxLength={30} onChange={(e) => setPattern(e.target.value)} aria-describedby={describedBy("bulk-pattern", { hint: true, error: err("pattern") })} />
          </Field>
          <Field id="bulk-capacity" label="Varsayılan kapasite" error={err("capacity")} hint="İsteğe bağlı">
            <Input id="bulk-capacity" name="capacity" inputMode="numeric" aria-describedby={describedBy("bulk-capacity", { hint: true, error: err("capacity") })} />
          </Field>
        </div>
        <p className="rounded-md bg-surface px-3 py-2 text-sm text-fg-muted" aria-live="polite">
          <span className="font-medium text-fg">Önizleme:</span> {preview}
        </p>
        <Checkbox id="bulk-qr" name="withQr" label="Her masaya QR kodu da oluştur" description="Etiketleri hemen basabilmeniz için önerilir." defaultChecked />
        <DialogButtons pending={pending} onClose={onClose} submitLabel={valid ? `${n} masa oluştur` : "Masaları oluştur"} />
      </form>
    </Dialog>
  );
}
