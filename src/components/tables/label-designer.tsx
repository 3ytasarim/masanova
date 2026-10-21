"use client";

/* eslint-disable @next/next/no-img-element -- önizleme oturumlu uç noktadan blob URL olarak gelir */
import { AlertTriangle, Download, FileText, Printer, QrCode } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils/cn";
import {
  A4_MM,
  BLEED_MM,
  LABEL_MAX_HEIGHT_MM,
  LABEL_MAX_WIDTH_MM,
  LABEL_MIN_MM,
  LABEL_SIZE_PRESETS,
  LABEL_SIZE_PRESET_KEYS,
  computeSheetLayout,
  type LabelSizePreset,
} from "@/lib/tables/label-geometry";
import { CTA_MAX, CTA_PRESETS, DEFAULT_LABEL_OPTIONS, INFO_MAX, LABEL_TEMPLATES, LABEL_TEMPLATE_KEYS, labelOptionsToParams, type LabelOptions } from "@/lib/tables/label-options";
import { ensureTablesQrAction } from "@/server/actions/tables.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

type TableOption = { id: string; name: string; areaId: string | null; active: boolean; hasQr: boolean };
type Mode = "single" | "sheet";
type Scope = "sube" | "bolge" | "secili";
type PreviewInfo = { warnings: string[]; qrMm: number; forced: boolean };

const ENDPOINT = "/panel/masalar/indir/etiket";

export function LabelDesigner({
  branches,
  branchId,
  areas,
  tables,
  initialTableId,
  hasLogo,
  hasBrandColor,
}: {
  branches: { id: string; name: string }[];
  branchId: string;
  areas: { id: string; name: string }[];
  tables: TableOption[];
  initialTableId: string | null;
  hasLogo: boolean;
  hasBrandColor: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const withQr = tables.filter((t) => t.hasQr);
  const [mode, setMode] = useState<Mode>("single");
  const [tableId, setTableId] = useState<string>(initialTableId ?? withQr[0]?.id ?? tables[0]?.id ?? "");
  const [scope, setScope] = useState<Scope>("sube");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [options, setOptions] = useState<LabelOptions>(DEFAULT_LABEL_OPTIONS);
  const [customW, setCustomW] = useState("60");
  const [customH, setCustomH] = useState("60");
  const [ctaMode, setCtaMode] = useState<string>(DEFAULT_LABEL_OPTIONS.cta);

  const set = <K extends keyof LabelOptions>(key: K, value: LabelOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));

  // Özel boyut: geçerliyse seçeneklere yansır; geçersizse önizleme son geçerli değerde kalır.
  const customError = useMemo(() => {
    if (options.size !== "custom") return null;
    const w = Number(customW.replace(",", "."));
    const h = Number(customH.replace(",", "."));
    if (!(w >= LABEL_MIN_MM && w <= LABEL_MAX_WIDTH_MM)) return `Genişlik ${LABEL_MIN_MM}–${LABEL_MAX_WIDTH_MM} mm olmalı.`;
    if (!(h >= LABEL_MIN_MM && h <= LABEL_MAX_HEIGHT_MM)) return `Yükseklik ${LABEL_MIN_MM}–${LABEL_MAX_HEIGHT_MM} mm olmalı.`;
    return null;
  }, [options.size, customW, customH]);
  const mmValue = (v: string) => Math.round(Number(v.replace(",", ".")) * 10) / 10;
  const sized: LabelOptions = options.size === "custom" && !customError ? { ...options, width: mmValue(customW), height: mmValue(customH) } : options;

  const targetTables = useMemo(() => {
    if (mode === "single") return tables.filter((t) => t.id === tableId);
    if (scope === "bolge") return tables.filter((t) => t.areaId === areaId);
    if (scope === "secili") return tables.filter((t) => selected.has(t.id));
    return tables;
  }, [mode, scope, areaId, selected, tables, tableId]);
  const printable = targetTables.filter((t) => t.hasQr);
  const missingQr = targetTables.filter((t) => !t.hasQr);
  const previewTableId = mode === "single" ? (tables.find((t) => t.id === tableId)?.hasQr ? tableId : null) : (printable[0]?.id ?? null);

  const effective: LabelOptions = mode === "sheet" ? { ...sized, bleed: false } : sized;
  const query = new URLSearchParams(labelOptionsToParams(effective));
  const queryKey = query.toString();
  const layout = computeSheetLayout({ width: effective.width, height: effective.height }, printable.length);

  // ─── Canlı önizleme (sunucuda çizilen gerçek SVG; PDF ile birebir aynı) ───
  const [preview, setPreview] = useState<{ url: string; info: PreviewInfo } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!previewTableId || customError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${ENDPOINT}?masa=${previewTableId}&bicim=onizleme&${queryKey}`, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setPreviewError(body?.error ?? "Önizleme üretilemedi.");
          return;
        }
        const info = JSON.parse(decodeURIComponent(res.headers.get("x-label-info") ?? "%7B%7D")) as PreviewInfo;
        const url = URL.createObjectURL(await res.blob());
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = url;
        setPreview({ url, info });
        setPreviewError(null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPreviewError("Önizleme üretilemedi.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [previewTableId, queryKey, customError]);
  useEffect(() => () => void (lastUrl.current && URL.revokeObjectURL(lastUrl.current)), []);

  // ─── Toplu: eksik QR'ları oluştur, A4 PDF indir ───
  const [ensuring, startEnsure] = useTransition();
  const ensureMissing = () =>
    startEnsure(async () => {
      const fd = new FormData();
      for (const t of missingQr) fd.append("masalar", t.id);
      const result = await ensureTablesQrAction(null, fd);
      if (result?.ok) {
        toast(result.message ?? "QR kodları oluşturuldu.", "success");
        router.refresh();
      } else if (result) toast(result.error, "error");
    });

  const [downloading, setDownloading] = useState(false);
  const downloadSheet = async () => {
    setDownloading(true);
    try {
      const fd = new FormData();
      for (const [k, v] of query.entries()) fd.append(k, v);
      fd.append("kapsam", scope);
      fd.append("sube", branchId);
      if (scope === "bolge") fd.append("bolge", areaId);
      if (scope === "secili") for (const id of selected) fd.append("masalar", id);
      const res = await fetch("/panel/masalar/indir/sayfa", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast(body?.error ?? "PDF üretilemedi.", "error");
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "qr-etiketleri.pdf";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const skipped = Number(res.headers.get("x-labels-skipped") ?? "0");
      toast(`A4 PDF hazır: ${res.headers.get("x-labels-printed")} etiket${skipped ? ` (${skipped} masa QR'sız olduğu için atlandı)` : ""}.`, "success");
    } catch {
      toast("PDF indirilemedi.", "error");
    } finally {
      setDownloading(false);
    }
  };

  const singleHref = (format: "pdf" | "svg") => `${ENDPOINT}?masa=${tableId}&bicim=${format}&${queryKey}`;
  const W = effective.width + (effective.bleed ? BLEED_MM * 2 : 0);
  const H = effective.height + (effective.bleed ? BLEED_MM * 2 : 0);

  if (tables.length === 0) {
    return <p className="rounded-lg border border-border bg-bg p-6 text-sm text-fg-muted">Bu şubede henüz masa yok. Önce Masalar sekmesinden masa oluşturun.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      {/* ─── Düzenleyici ─── */}
      <div className="grid content-start gap-5">
        <fieldset className="grid gap-3 rounded-lg border border-border bg-bg p-4">
          <legend className="px-1 text-sm font-semibold">Ne basılacak?</legend>
          <div role="radiogroup" aria-label="Baskı türü" className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
            {(
              [
                ["single", "Tek etiket"],
                ["sheet", "Toplu A4 sayfa"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn("min-h-10 rounded px-3 text-sm font-medium transition-colors", mode === value ? "bg-bg text-fg shadow-xs" : "text-fg-subtle hover:text-fg")}
              >
                {label}
              </button>
            ))}
          </div>
          {branches.length > 1 ? (
            <Field id="lb-branch" label="Şube">
              <Select id="lb-branch" value={branchId} onChange={(e) => router.push(`/panel/masalar/etiketler?sube=${e.target.value}`)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {mode === "single" ? (
            <Field id="lb-table" label="Masa">
              <Select id="lb-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.hasQr ? "" : " — QR yok"}
                    {t.active ? "" : " (pasif)"}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <SheetScope
              scope={scope}
              setScope={setScope}
              areas={areas}
              areaId={areaId}
              setAreaId={setAreaId}
              tables={tables}
              selected={selected}
              setSelected={setSelected}
            />
          )}
        </fieldset>

        <fieldset className="grid gap-3 rounded-lg border border-border bg-bg p-4">
          <legend className="px-1 text-sm font-semibold">Şablon</legend>
          <div role="radiogroup" aria-label="Etiket şablonu" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
            {LABEL_TEMPLATE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={options.template === key}
                onClick={() => set("template", key)}
                className={cn(
                  "grid min-h-12 gap-0.5 rounded-md border p-2.5 text-left transition-colors",
                  options.template === key ? "border-fg bg-surface" : "border-border hover:border-border-strong",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <TemplateSwatch template={key} />
                  {LABEL_TEMPLATES[key].label}
                </span>
                <span className="text-xs text-fg-subtle">{LABEL_TEMPLATES[key].description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-3 rounded-lg border border-border bg-bg p-4">
          <legend className="px-1 text-sm font-semibold">Boyut</legend>
          <Field id="lb-size" label="Etiket boyutu">
            <Select
              id="lb-size"
              value={options.size}
              onChange={(e) => {
                const size = e.target.value as LabelSizePreset | "custom";
                if (size === "custom") setOptions((o) => ({ ...o, size }));
                else setOptions((o) => ({ ...o, size, width: LABEL_SIZE_PRESETS[size].width, height: LABEL_SIZE_PRESETS[size].height }));
              }}
            >
              {LABEL_SIZE_PRESET_KEYS.map((k) => (
                <option key={k} value={k}>
                  {LABEL_SIZE_PRESETS[k].label}
                </option>
              ))}
              <option value="custom">Özel boyut…</option>
            </Select>
          </Field>
          {options.size === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field id="lb-w" label="Genişlik (mm)" error={customError?.startsWith("Genişlik") ? customError : undefined}>
                <Input id="lb-w" inputMode="decimal" value={customW} onChange={(e) => setCustomW(e.target.value)} aria-describedby={describedBy("lb-w", { error: customError?.startsWith("Genişlik") })} />
              </Field>
              <Field id="lb-h" label="Yükseklik (mm)" error={customError?.startsWith("Yükseklik") ? customError : undefined}>
                <Input id="lb-h" inputMode="decimal" value={customH} onChange={(e) => setCustomH(e.target.value)} aria-describedby={describedBy("lb-h", { error: customError?.startsWith("Yükseklik") })} />
              </Field>
            </div>
          ) : null}
          <Checkbox
            id="lb-bleed"
            label={`${BLEED_MM} mm taşma payı (bleed)`}
            description={mode === "sheet" ? "A4 sayfada uygulanmaz; kesim işaretleri eklenir." : "Matbaada kenara kadar baskı için zemin kesim çizgisinin dışına taşar."}
            checked={options.bleed}
            disabled={mode === "sheet"}
            onChange={(e) => set("bleed", e.target.checked)}
          />
        </fieldset>

        <fieldset className="grid gap-3 rounded-lg border border-border bg-bg p-4">
          <legend className="px-1 text-sm font-semibold">Metin ve görünüm</legend>
          <Field id="lb-cta" label="Çağrı metni">
            <Select
              id="lb-cta"
              value={ctaMode}
              onChange={(e) => {
                setCtaMode(e.target.value);
                if (e.target.value !== "custom") set("cta", e.target.value);
              }}
            >
              {CTA_PRESETS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="custom">Özel metin…</option>
            </Select>
          </Field>
          {ctaMode === "custom" ? (
            <Field id="lb-cta-custom" label="Özel çağrı metni" hint={`En fazla ${CTA_MAX} karakter`}>
              <Input id="lb-cta-custom" maxLength={CTA_MAX} defaultValue={options.cta} onChange={(e) => set("cta", e.target.value || DEFAULT_LABEL_OPTIONS.cta)} aria-describedby={describedBy("lb-cta-custom", { hint: true })} />
            </Field>
          ) : null}
          <Field id="lb-info" label="Bilgi satırı" hint="İsteğe bağlı küçük not (ör. ileride Wi-Fi bilgisi). Boşsa basılmaz.">
            <Input id="lb-info" maxLength={INFO_MAX} value={options.info} onChange={(e) => set("info", e.target.value)} aria-describedby={describedBy("lb-info", { hint: true })} />
          </Field>
          <div className="grid gap-2">
            <Checkbox
              id="lb-logo"
              label="Logo"
              description={hasLogo ? "PNG/JPEG logo etikete gömülür." : "İşletmeye logo tanımlı değil; işletme adı kullanılır."}
              checked={options.showLogo && hasLogo}
              disabled={!hasLogo}
              onChange={(e) => set("showLogo", e.target.checked)}
            />
            <Checkbox id="lb-name" label="İşletme adı" checked={options.showName} onChange={(e) => set("showName", e.target.checked)} />
            <Checkbox id="lb-powered" label="“Powered by MasaNova AI” imzası" checked={options.poweredBy} onChange={(e) => set("poweredBy", e.target.checked)} />
          </div>
          <div role="radiogroup" aria-labelledby="lb-qr-label" className="grid gap-1.5">
            <span id="lb-qr-label" className="text-sm font-medium">
              QR rengi
            </span>
            {(
              [
                ["black", "Siyah (önerilen, en yüksek okunabilirlik)"],
                ["brand", hasBrandColor ? "Marka rengi (yalnızca kontrast güvenliyse)" : "Marka rengi (tanımlı değil — siyah kullanılır)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="lb-qr" value={value} checked={options.qrColor === value} onChange={() => set("qrColor", value)} className="size-4 accent-primary" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* ─── Önizleme ─── */}
      <aside aria-label="Önizleme" className="grid content-start gap-4 lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">
              Önizleme {mode === "sheet" && printable[0] ? <span className="font-normal text-fg-subtle">· {printable[0].name}</span> : null}
            </span>
            <span className="text-fg-subtle tabular-nums">
              {fmt(effective.width)} × {fmt(effective.height)} mm{effective.bleed ? ` + ${BLEED_MM} mm taşma` : ""}
            </span>
          </div>
          <div className="mx-auto flex w-full max-w-md items-center justify-center">
            <div className="relative w-full overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-black/5" style={{ aspectRatio: `${W} / ${H}`, maxWidth: W >= H ? "100%" : `${(W / H) * 100}%` }}>
              {previewTableId && preview && !previewError ? (
                <img src={preview.url} alt={`Etiket önizlemesi: ${LABEL_TEMPLATES[effective.template].label} şablon, ${fmt(effective.width)} × ${fmt(effective.height)} mm`} className="absolute inset-0 size-full" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-fg-subtle">
                  <QrCode aria-hidden="true" className="size-8" />
                  {previewError ?? (previewTableId ? "Önizleme hazırlanıyor…" : "Önizleme için QR kodu olan bir masa seçin.")}
                </div>
              )}
              {loading ? (
                <span className="absolute right-2 top-2 rounded-full bg-bg/90 p-1 shadow-xs">
                  <Spinner label="Önizleme güncelleniyor" />
                </span>
              ) : null}
            </div>
          </div>
          <div aria-live="polite" className="mt-3 grid gap-2">
            {preview && previewTableId ? <p className="text-center text-xs text-fg-subtle">QR boyutu: {fmt(preview.info.qrMm)} mm · hata düzeltme H (%30)</p> : null}
            {preview?.info.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {w}
              </p>
            ))}
          </div>
        </div>

        {mode === "single" ? (
          <div className="grid gap-2 rounded-lg border border-border bg-bg p-4">
            {previewTableId ? (
              <div className="grid grid-cols-2 gap-2">
                <a href={customError ? undefined : singleHref("pdf")} download aria-disabled={!!customError} className={buttonVariants({ className: customError ? "pointer-events-none opacity-50" : "" })}>
                  <FileText aria-hidden="true" /> PDF indir
                </a>
                <a href={customError ? undefined : singleHref("svg")} download aria-disabled={!!customError} className={buttonVariants({ variant: "secondary", className: customError ? "pointer-events-none opacity-50" : "" })}>
                  <Download aria-hidden="true" /> SVG indir
                </a>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Seçili masanın QR kodu yok. Masa sayfasından QR oluşturun.</p>
            )}
            <p className="text-xs text-fg-subtle">PDF gerçek fiziksel ölçüde, vektör (metin ve QR yol olarak) üretilir. Baskıda “Gerçek boyut / %100” seçin.</p>
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-border bg-bg p-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              <SheetSchematic layout={layout} label={{ width: effective.width, height: effective.height }} />
              <dl className="grid flex-1 content-start gap-2 text-sm">
                <Row label="Seçilen masa" value={String(targetTables.length)} />
                <Row label="Basılacak etiket" value={String(printable.length)} />
                <Row label="Sayfa başına" value={layout.perPage ? `${layout.perPage} (${layout.columns} × ${layout.rows})` : "Sığmıyor"} />
                <Row label="Sayfa" value={String(layout.pages)} />
              </dl>
            </div>
            {layout.warning ? (
              <p role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {layout.warning}
              </p>
            ) : null}
            {missingQr.length > 0 ? (
              <div className="grid gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-sm">
                <p>
                  <span className="font-medium">{missingQr.length} masanın QR kodu yok</span> — bu masalar sayfaya eklenmez.
                </p>
                <div>
                  <Button size="sm" variant="secondary" loading={ensuring} onClick={ensureMissing}>
                    <QrCode aria-hidden="true" /> Eksik QR kodlarını oluştur
                  </Button>
                </div>
              </div>
            ) : null}
            <Button onClick={downloadSheet} loading={downloading} disabled={!printable.length || !layout.perPage || !!customError}>
              <Printer aria-hidden="true" /> A4 PDF indir
            </Button>
            <p className="text-xs text-fg-subtle">Etiketler gerçek ölçüsünde yerleşir, ölçeklenmez. Kesim işaretleri etiket köşelerindedir.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function SheetScope({
  scope,
  setScope,
  areas,
  areaId,
  setAreaId,
  tables,
  selected,
  setSelected,
}: {
  scope: Scope;
  setScope: (s: Scope) => void;
  areas: { id: string; name: string }[];
  areaId: string;
  setAreaId: (id: string) => void;
  tables: TableOption[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Kapsam" className="grid gap-1.5">
        {(
          [
            ["sube", "Şubedeki tüm masalar"],
            ["bolge", "Bir bölge"],
            ["secili", "Seçili masalar"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="lb-scope" value={value} checked={scope === value} onChange={() => setScope(value)} className="size-4 accent-primary" disabled={value === "bolge" && areas.length === 0} />
            {label}
          </label>
        ))}
      </div>
      {scope === "bolge" ? (
        <Field id="lb-area" label="Bölge">
          <Select id="lb-area" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {scope === "secili" ? (
        <fieldset className="grid gap-2">
          <legend className="sr-only">Masalar</legend>
          <div className="flex items-center justify-between text-sm">
            <span className="text-fg-subtle">{selected.size} seçili</span>
            <span className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(tables.map((t) => t.id)))}>
                Tümünü seç
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Temizle
              </Button>
            </span>
          </div>
          <ul className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-2">
            {tables.map((t) => (
              <li key={t.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-surface">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="size-4 accent-primary" />
                  <span className="min-w-0 truncate">{t.name}</span>
                  {!t.hasQr ? <span className="ml-auto shrink-0 text-[0.6875rem] text-warning">QR yok</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}

/** A4 yerleşim şeması (gerçek oranlarda; etiketler hesaplanan konumlarda). */
function SheetSchematic({ layout, label }: { layout: ReturnType<typeof computeSheetLayout>; label: { width: number; height: number } }) {
  return (
    <div className="relative mx-auto w-28 shrink-0 bg-white shadow-sm ring-1 ring-black/10" style={{ aspectRatio: `${A4_MM.width} / ${A4_MM.height}` }} aria-hidden="true">
      {layout.positions.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-[1px] bg-fg/15 ring-1 ring-fg/30"
          style={{ left: `${(p.x / A4_MM.width) * 100}%`, top: `${(p.y / A4_MM.height) * 100}%`, width: `${(label.width / A4_MM.width) * 100}%`, height: `${(label.height / A4_MM.height) * 100}%` }}
        />
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

const SWATCHES: Record<string, [string, string]> = {
  minimal: ["#ffffff", "#111111"],
  modern: ["#1f2937", "#f59e0b"],
  dark: ["#101114", "#ffffff"],
  luxury: ["#f6f0e4", "#a3824a"],
  cafe: ["#fbf3e7", "#e8a87c"],
};

function TemplateSwatch({ template }: { template: string }) {
  const [bg, fg] = SWATCHES[template] ?? ["#fff", "#000"];
  return (
    <span aria-hidden="true" className="inline-flex size-4 items-center justify-center rounded-sm ring-1 ring-black/15" style={{ backgroundColor: bg }}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: fg }} />
    </span>
  );
}

function fmt(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1).replace(".", ",");
}
