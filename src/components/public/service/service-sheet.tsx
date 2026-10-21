"use client";

import { CheckCircle2, ConciergeBell, Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ServiceRequestType } from "@prisma/client";
import type { ServiceStrings } from "@/lib/public-menu/i18n-service";
import { SERVICE_NOTE_MAX, SERVICE_REQUEST_TYPES } from "@/lib/service-requests/types";
import { cn } from "@/lib/utils/cn";
import { cancelOwnServiceRequestAction, submitServiceRequestAction } from "@/server/actions/service-request.actions";
import type { CustomerServiceRequestView } from "@/server/services/service-requests/customer-request.service";
import { SERVICE_TYPE_ICONS } from "@/components/service/service-icons";

type Step = { kind: "menu" } | { kind: "confirm"; type: ServiceRequestType } | { kind: "result"; type: ServiceRequestType; duplicate: boolean };

/**
 * "Servis İste" alttan açılan sayfası: tip seçimi → onay (yanlışlıkla talep olmasın) → sonuç. Hesap talebi ödeme
 * değildir. Oturum / ad / telefon istenmez. Gönderim sürerken düğmeler kilitlenir; sunucu da masa + tip başına tek
 * aktif talebi zorlar (çift dokunuş ikinci talep oluşturmaz → "zaten iletildi").
 */
export function ServiceSheet({
  open,
  onClose,
  s,
  token,
  requests,
  recentOrders,
  onResult,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  s: ServiceStrings;
  token: string;
  requests: CustomerServiceRequestView[];
  recentOrders: string[];
  onResult: (request: CustomerServiceRequestView) => void;
  onRefresh: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ kind: "menu" });
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const noteId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      document.querySelectorAll("dialog[open]").forEach((other) => other !== d && (other as HTMLDialogElement).close());
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const reset = () => {
    setStep({ kind: "menu" });
    setNote("");
    setError(null);
  };
  const close = () => {
    if (sendingRef.current) return;
    onClose();
  };

  async function send(type: ServiceRequestType) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const res = await submitServiceRequestAction(token, { type, note: type === "CUSTOM" ? note : null, recentOrders });
      if (res.kind === "created" || res.kind === "duplicate") {
        onResult(res.request);
        setStep({ kind: "result", type, duplicate: res.kind === "duplicate" });
        setNote("");
      } else if (res.kind === "rejected") {
        setError(res.reason === "context_invalid" ? s.errorContext : res.reason === "rate_limited" ? s.errorRateLimited : s.errorGeneric);
      }
    } catch {
      setError(s.errorGeneric);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function withdraw(publicId: string) {
    try {
      await cancelOwnServiceRequestAction(token, publicId);
    } finally {
      onRefresh();
    }
  }

  const active = requests.filter((r) => r.status === "OPEN" || r.status === "ACKNOWLEDGED");
  const titleId = "pm-service-title";

  return (
    <dialog
      ref={ref}
      onClose={() => {
        onClose();
        reset();
      }}
      onClick={(e) => e.target === ref.current && close()}
      onCancel={(e) => sendingRef.current && e.preventDefault()}
      aria-labelledby={titleId}
      data-testid="service-sheet"
      className="m-0 mt-auto hidden open:flex max-h-[94dvh] w-full max-w-none flex-col overflow-hidden rounded-t-[1.75rem] bg-[#faf8f5] p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45 open:motion-safe:animate-[pm-sheet-in_260ms_cubic-bezier(0.16,1,0.3,1)] sm:m-auto sm:max-h-[88dvh] sm:max-w-xl sm:rounded-[1.75rem]"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 id={titleId} className="text-[1.25rem] font-semibold tracking-tight">
          {s.title}
        </h2>
        <button type="button" onClick={close} disabled={sending} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-stone-200/60 disabled:opacity-40">
          <X aria-hidden="true" className="size-5" />
          <span className="sr-only">{s.close}</span>
        </button>
      </div>

      <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {error ? (
          <p role="alert" data-testid="service-error" className="mb-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800 ring-1 ring-red-200">
            {error}
          </p>
        ) : null}

        {step.kind === "menu" ? (
          <>
            <p className="text-[0.9375rem] text-stone-600">{s.subtitle}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {SERVICE_REQUEST_TYPES.map((type) => {
                const Icon = SERVICE_TYPE_ICONS[type];
                const isActive = active.some((r) => r.type === type);
                return (
                  <button
                    key={type}
                    type="button"
                    data-service-type={type}
                    onClick={() => {
                      setError(null);
                      setStep({ kind: "confirm", type });
                    }}
                    className={cn(
                      "relative flex min-h-[4.5rem] items-center gap-3 rounded-2xl bg-white px-4 text-start text-[1rem] font-semibold shadow-sm ring-1 ring-stone-900/10 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]",
                      type === "CUSTOM" && "col-span-2",
                    )}
                  >
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand)]/10 text-[var(--pm-brand)]">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="min-w-0">{s.types[type]}</span>
                    {isActive ? <span aria-hidden="true" className="absolute end-3 top-3 size-2.5 rounded-full bg-amber-500" /> : null}
                  </button>
                );
              })}
            </div>
            {requests.length ? (
              <section aria-labelledby="pm-service-active" className="mt-6">
                <h3 id="pm-service-active" className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                  {s.activeTitle}
                </h3>
                <ul className="mt-2 grid gap-2">
                  {requests.map((r) => {
                    const Icon = SERVICE_TYPE_ICONS[r.type];
                    return (
                      <li key={r.publicId} className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-stone-900/10" data-testid="service-request" data-type={r.type} data-status={r.status}>
                        <Icon aria-hidden="true" className="size-5 shrink-0 text-stone-500" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[0.9375rem] font-semibold">{s.types[r.type]}</p>
                          <p className={cn("text-sm", r.status === "COMPLETED" ? "text-emerald-700" : r.status === "CANCELLED" ? "text-stone-500" : "text-stone-600")}>{s.status(r.status, r.staffName)}</p>
                          {r.note ? <p className="mt-0.5 break-words text-sm italic text-stone-500">“{r.note}”</p> : null}
                        </div>
                        {r.status === "OPEN" ? (
                          <button type="button" onClick={() => void withdraw(r.publicId)} className="min-h-10 shrink-0 rounded-full px-3 text-sm font-medium text-stone-600 ring-1 ring-stone-900/10 hover:bg-stone-100">
                            {s.withdraw}
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        {step.kind === "confirm" ? (
          <div className="pt-2" data-testid="service-confirm">
            {(() => {
              const Icon = SERVICE_TYPE_ICONS[step.type];
              return <Icon aria-hidden="true" className="mx-auto mt-2 size-10 text-[var(--pm-brand)]" />;
            })()}
            <p className="mt-3 text-center text-[1.0625rem] font-semibold">{s.confirm[step.type]}</p>
            {step.type === "CUSTOM" ? (
              <div className="mt-4">
                <label htmlFor={noteId} className="text-sm font-medium text-stone-700">
                  {s.customLabel}
                </label>
                <textarea
                  id={noteId}
                  value={note}
                  maxLength={SERVICE_NOTE_MAX}
                  rows={3}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={s.customPlaceholder}
                  aria-describedby={`${noteId}-hint`}
                  className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-2.5 text-[1rem] ring-1 ring-stone-900/15 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[var(--pm-accent)]"
                />
                <p id={`${noteId}-hint`} className="mt-1 flex justify-between gap-3 text-xs text-stone-500">
                  <span>{s.customHint}</span>
                  <span className="tabular-nums">
                    {note.length}/{SERVICE_NOTE_MAX}
                  </span>
                </p>
              </div>
            ) : null}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={reset} disabled={sending} className="min-h-14 rounded-full bg-white text-[1rem] font-semibold ring-1 ring-stone-900/10 disabled:opacity-50">
                {s.cancel}
              </button>
              <button
                type="button"
                data-testid="service-send"
                onClick={() => void send(step.type)}
                disabled={sending || (step.type === "CUSTOM" && note.trim().length < 2)}
                className="min-h-14 rounded-full bg-[var(--pm-brand)] px-3 text-[1rem] font-semibold text-[var(--pm-on-brand)] disabled:opacity-50"
              >
                {sending ? s.sending : s.confirmAction[step.type]}
              </button>
            </div>
          </div>
        ) : null}

        {step.kind === "result" ? (
          <div className="pt-2 text-center" data-testid="service-result" data-duplicate={step.duplicate}>
            {step.duplicate ? <Info aria-hidden="true" className="mx-auto mt-2 size-12 text-amber-600" /> : <CheckCircle2 aria-hidden="true" className="mx-auto mt-2 size-12 text-emerald-600" />}
            <p role="status" className="mt-3 text-[1.125rem] font-semibold">
              {step.duplicate ? s.alreadySent[step.type] : s.sent[step.type]}
            </p>
            {(() => {
              const current = requests.find((r) => r.type === step.type && (r.status === "OPEN" || r.status === "ACKNOWLEDGED"));
              return current ? <p className="mt-1 text-[0.9375rem] text-stone-600">{s.status(current.status, current.staffName)}</p> : null;
            })()}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={reset} className="min-h-14 rounded-full bg-white text-[1rem] font-semibold ring-1 ring-stone-900/10">
                {s.title}
              </button>
              <button type="button" onClick={close} className="min-h-14 rounded-full bg-[var(--pm-brand)] text-[1rem] font-semibold text-[var(--pm-on-brand)]">
                {s.close}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/** Menüdeki "Servis" düğmesi (sepet çubuğunun yanında; aktif talep varsa nokta). */
export function ServiceButton({ s, onOpen, active, compact }: { s: ServiceStrings; onOpen: () => void; active: boolean; compact: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid="service-button"
      className={cn(
        "pointer-events-auto relative inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-4 text-[0.9375rem] font-semibold text-stone-900 shadow-lg ring-1 ring-stone-900/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]",
        compact && "w-14 px-0",
      )}
    >
      <ConciergeBell aria-hidden="true" className="size-5" />
      <span className={cn(compact && "sr-only")}>{s.button}</span>
      {active ? <span aria-hidden="true" className="absolute end-1.5 top-1.5 size-3 rounded-full bg-amber-500 ring-2 ring-white" /> : null}
    </button>
  );
}

/** Son talebin kısa durum bandı (bağlantı kesintisi 3 sn'yi aşarsa küçük not). */
export function ServiceStatusChip({ s, request, reconnecting }: { s: ServiceStrings; request: CustomerServiceRequestView; reconnecting: boolean }) {
  const Icon = SERVICE_TYPE_ICONS[request.type];
  return (
    <div className="pointer-events-auto mx-auto mb-2 flex w-full max-w-md items-center gap-2.5 rounded-2xl bg-white/95 px-3.5 py-2.5 text-sm shadow-lg ring-1 ring-stone-900/10 backdrop-blur" data-testid="service-status" data-status={request.status} data-type={request.type}>
      <Icon aria-hidden="true" className="size-4 shrink-0 text-stone-500" />
      <p aria-live="polite" className="min-w-0 flex-1 truncate font-medium">
        {s.status(request.status, request.staffName)}
      </p>
      {reconnecting ? <span className="mn-delayed-show shrink-0 text-xs text-stone-500">{s.reconnecting}</span> : null}
    </div>
  );
}
