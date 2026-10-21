"use client";

/* eslint-disable @next/next/no-img-element -- yüklenen görselin önizlemesi (blob: / sürümlü /media adresi); next/image optimize etmez */
import { CheckCircle2, ImageUp, Trash2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { ACCEPT_ATTRIBUTE, ACCEPTED_IMAGE_MIME, formatMegabytes, MEDIA_ERROR_MESSAGES, MEDIA_RULES, tooLargeMessage, type MediaKindKey } from "@/lib/media/limits";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Bilgisayardan görsel yükleme: sürükle-bırak (masaüstü) ya da standart dosya seçici (mobil dahil).
 * Durumlar gerçektir: "Yükleniyor %n" (XHR yükleme ilerlemesi — tarayıcı veriyorsa), "İşleniyor…" (sunucu
 * sharp ile çıktıları üretirken; yüzde UYDURULMAZ), "Tamamlandı". Hatalar dostça; dosya sistemi ayrıntısı yok.
 * Asıl doğrulama sunucudadır (imza, boyut, piksel); buradaki tür / boyut ön kontrolü yalnızca gereksiz yüklemeyi önler.
 */
type Phase = { kind: "idle" } | { kind: "uploading"; percent: number | null } | { kind: "processing" } | { kind: "done" } | { kind: "error"; message: string };

const ASPECT: Record<MediaKindKey, string> = { PRODUCT: "aspect-[4/3]", CATEGORY: "aspect-[3/1]", HERO: "aspect-[3/1]", LOGO: "aspect-square" };

export type ImageUploaderProps = {
  kind: MediaKindKey;
  /** Hedef alanları (productId / categoryId / replaceImageId). Kiracı asla istemciden gönderilmez. */
  fields?: Record<string, string>;
  /** Kaldırma isteği gövdesi; verilmezse "Kaldır" gösterilmez. */
  removeBody?: Record<string, string>;
  currentUrl: string | null;
  label: string;
  disabled?: boolean;
  /** Yalnızca düğme (ör. galeride "Değiştir"). */
  compact?: boolean;
  compactLabel?: string;
  testId?: string;
  className?: string;
};

export function ImageUploader({ kind, fields, removeBody, currentUrl, label, disabled, compact, compactLabel, testId = "image-uploader", className }: ImageUploaderProps) {
  const router = useRouter();
  const inputId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const rule = MEDIA_RULES[kind];
  const busy = phase.kind === "uploading" || phase.kind === "processing";

  useEffect(() => () => xhrRef.current?.abort(), []);
  useEffect(() => {
    if (!localPreview) return;
    return () => URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  function start(file: File) {
    if (!(ACCEPTED_IMAGE_MIME as readonly string[]).includes(file.type)) {
      setPhase({ kind: "error", message: MEDIA_ERROR_MESSAGES.unsupported });
      return;
    }
    if (file.size > rule.maxBytes) {
      setPhase({ kind: "error", message: tooLargeMessage(kind) });
      return;
    }
    setLocalPreview(URL.createObjectURL(file));
    setConfirmRemove(false);
    const body = new FormData();
    body.set("kind", kind);
    for (const [k, v] of Object.entries(fields ?? {})) body.set(k, v);
    body.set("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/v1/media");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => setPhase({ kind: "uploading", percent: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null });
    xhr.upload.onload = () => setPhase({ kind: "processing" });
    xhr.onerror = () => fail(MEDIA_ERROR_MESSAGES.failed);
    xhr.onload = () => {
      const json = (xhr.response ?? {}) as { ok?: boolean; error?: string };
      if (xhr.status >= 200 && xhr.status < 300 && json.ok) {
        setPhase({ kind: "done" });
        router.refresh();
      } else {
        fail(json.error ?? MEDIA_ERROR_MESSAGES.failed);
      }
    };
    setPhase({ kind: "uploading", percent: 0 });
    xhr.send(body);
  }

  function fail(message: string) {
    setPhase({ kind: "error", message });
    setLocalPreview(null);
  }

  async function remove() {
    if (!removeBody) return;
    setPhase({ kind: "processing" });
    try {
      const response = await fetch("/api/v1/media", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, ...removeBody }) });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) return fail(json.error ?? MEDIA_ERROR_MESSAGES.failed);
      setLocalPreview(null);
      setConfirmRemove(false);
      setPhase({ kind: "idle" });
      router.refresh();
    } catch {
      fail(MEDIA_ERROR_MESSAGES.failed);
    }
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) start(file);
  }

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept={ACCEPT_ATTRIBUTE}
      className="sr-only"
      disabled={disabled || busy}
      aria-describedby={statusId}
      data-testid={`${testId}-input`}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) start(file);
      }}
    />
  );

  const status = (
    <p id={statusId} role={phase.kind === "error" ? "alert" : "status"} aria-live="polite" data-testid={`${testId}-status`} data-phase={phase.kind} className={cn("min-h-5 text-sm", phase.kind === "error" ? "text-danger" : "text-fg-muted")}>
      {phase.kind === "uploading" ? (
        <span className="inline-flex items-center gap-2">
          <Spinner /> Yükleniyor{phase.percent !== null ? ` %${phase.percent}` : "…"}
        </span>
      ) : phase.kind === "processing" ? (
        <span className="inline-flex items-center gap-2">
          <Spinner /> İşleniyor…
        </span>
      ) : phase.kind === "done" ? (
        <span className="inline-flex items-center gap-1.5 text-success">
          <CheckCircle2 aria-hidden="true" className="size-4" /> Tamamlandı
        </span>
      ) : phase.kind === "error" ? (
        phase.message
      ) : null}
    </p>
  );

  if (compact) {
    return (
      <div className={cn("grid gap-1", className)} data-testid={testId}>
        {input}
        <Button variant="ghost" size="sm" disabled={disabled || busy} loading={busy} onClick={() => inputRef.current?.click()}>
          <ImageUp aria-hidden="true" /> {compactLabel ?? "Değiştir"}
        </Button>
        {phase.kind !== "idle" ? status : null}
      </div>
    );
  }

  const preview = localPreview ?? currentUrl;
  return (
    <div className={cn("grid gap-2", className)} data-testid={testId}>
      <span className="text-sm font-medium text-fg">{label}</span>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "relative flex w-full min-w-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-center transition-colors",
          ASPECT[kind],
          kind === "LOGO" ? "max-w-40" : "",
          dragging ? "border-primary bg-primary/5" : "border-border-strong bg-surface hover:border-fg-subtle",
          (disabled || busy) && "cursor-not-allowed opacity-80",
        )}
      >
        {input}
        {preview ? (
          <img src={preview} alt="" data-testid={`${testId}-preview`} className={cn("absolute inset-0 size-full", kind === "LOGO" ? "object-contain p-3" : "object-cover")} />
        ) : (
          <span className="flex flex-col items-center gap-1.5 px-3 text-sm text-fg-muted">
            <UploadCloud aria-hidden="true" className="size-6" />
            <span>
              <span className="font-medium text-fg">Bilgisayardan seçin</span>
              <span className="hidden sm:inline"> ya da sürükleyip bırakın</span>
            </span>
          </span>
        )}
        {busy ? <span aria-hidden="true" className="absolute inset-0 bg-bg/50" /> : null}
      </label>
      <p className="text-xs text-fg-subtle" data-testid={`${testId}-hint`}>
        Önerilen: {rule.recommended.width} × {rule.recommended.height} px ({rule.recommended.ratio}) · JPEG, PNG, WebP · en fazla {formatMegabytes(rule.maxBytes)}. {rule.note}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={disabled || busy} onClick={() => inputRef.current?.click()} data-testid={`${testId}-choose`}>
          <ImageUp aria-hidden="true" /> {currentUrl ? "Değiştir" : "Görsel seç"}
        </Button>
        {removeBody && currentUrl && !busy ? (
          confirmRemove ? (
            <>
              <Button variant="danger" size="sm" disabled={disabled} onClick={remove} data-testid={`${testId}-remove-confirm`}>
                Evet, kaldır
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                Vazgeç
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirmRemove(true)} data-testid={`${testId}-remove`}>
              <Trash2 aria-hidden="true" /> Kaldır
            </Button>
          )
        ) : null}
      </div>
      {status}
    </div>
  );
}
