"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { splitEqually } from "@/lib/payments/allocation";
import { paymentStrings } from "@/lib/payments/i18n";
import type { PaymentStatusName, PaymentSummary } from "@/lib/payments/state";
import { parsePriceToMinor } from "@/lib/menu/money";
import { cn } from "@/lib/utils/cn";
import { paymentStatusAction, startPaymentAction } from "@/server/actions/payment-public.actions";

export type PayLine = { id: string; name: string; quantity: number; remainingUnits: number; nextUnitsAmounts: number[] };
type Mode = "FULL" | "AMOUNT" | "EQUAL" | "ITEMS";

type Props = {
  token: string;
  orderPublicId: string;
  currency: string;
  numberLocale: string;
  /** Metinler istemcide üretilir (fonksiyonlu metinler sunucudan prop olarak geçirilemez). */
  locale: string;
  summary: PaymentSummary;
  lines: PayLine[];
  /** Dönüş sayfası: ?p=<ödeme public kimliği> → yetkili durum sorgulanır (yönlendirme kanıt değildir). */
  verifyPaymentId: string | null;
};

const POLL_MS = 2000;
const POLL_MAX = 30; // ~60 sn; sonra "hâlâ bekliyor" (tekrar ödeme önerilmez)

function newKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Müşteri ödeme paneli. Tutarlar yalnızca GÖSTERİM içindir: sunucu tutarı kalıcı sipariş toplamından yeniden hesaplar
 * ve kalan bakiyeyi aşan isteği reddeder. Aynı istek aynı idempotency anahtarıyla gider (çift tıklama = tek ödeme);
 * seçim değişince yeni anahtar üretilir.
 */
export function PayPanel({ token, orderPublicId, currency, numberLocale, locale, summary, lines, verifyPaymentId }: Props) {
  const s = paymentStrings(locale);
  const router = useRouter();
  const money = (minor: number) => new Intl.NumberFormat(numberLocale, { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
  const [mode, setMode] = useState<Mode>("FULL");
  const [amountText, setAmountText] = useState("");
  const [people, setPeople] = useState(2);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ id: string; status: PaymentStatusName | "TIMEOUT" } | null>(verifyPaymentId ? { id: verifyPaymentId, status: "PENDING" } : null);
  const key = useRef<string | null>(null);

  const available = summary.available;
  const shares = useMemo(() => splitEqually(available, Math.max(1, people)), [available, people]);
  const itemsAmount = lines.reduce((sum, l) => sum + (l.nextUnitsAmounts.slice(0, picked[l.id] ?? 0).reduce((a, b) => a + b, 0)), 0);
  const typed = parsePriceToMinor(amountText);
  const amount = mode === "FULL" ? available : mode === "EQUAL" ? (shares[0] ?? 0) : mode === "AMOUNT" ? (typed ?? 0) : itemsAmount;
  const valid = amount > 0 && amount <= available && (mode !== "ITEMS" || Object.values(picked).some((q) => q > 0));

  // Seçim değiştiyse önceki anahtar yeniden kullanılmaz (aksi halde sunucu "idempotency_conflict" der).
  useEffect(() => {
    key.current = null;
  }, [mode, amountText, people, picked]);

  // Yetkili durum sorgusu (webhook gelmediyse sunucu sağlayıcıya sorar).
  useEffect(() => {
    if (!verify || verify.status !== "PENDING") return;
    let n = 0;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await paymentStatusAction(token, orderPublicId, verify.id).catch(() => null);
      if (stop) return;
      const status = r?.kind === "ok" ? r.payment?.status : null;
      if (status && status !== "PENDING" && status !== "PROCESSING") {
        setVerify({ id: verify.id, status });
        router.refresh();
        return;
      }
      if (++n >= POLL_MAX) return setVerify({ id: verify.id, status: "TIMEOUT" });
      setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [verify, token, orderPublicId, router]);

  async function pay() {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    key.current ??= newKey();
    try {
      const res = await startPaymentAction(token, orderPublicId, {
        mode,
        amountMinor: mode === "AMOUNT" || mode === "EQUAL" ? amount : null,
        items: mode === "ITEMS" ? Object.entries(picked).filter(([, q]) => q > 0).map(([line, quantity]) => ({ line, quantity })) : null,
        idempotencyKey: key.current,
      });
      if (res.kind === "rejected") {
        setError(s.reasons[res.reason]);
        key.current = null;
        router.refresh();
        return;
      }
      if (res.redirectUrl && (res.status === "PENDING" || res.status === "PROCESSING")) {
        window.location.assign(res.redirectUrl);
        return;
      }
      setVerify({ id: res.paymentPublicId, status: res.status === "PROCESSING" ? "PENDING" : res.status });
      key.current = null;
      router.refresh();
    } catch {
      setError(s.reasons.provider_unavailable);
    } finally {
      setBusy(false);
    }
  }

  if (verify) {
    const pending = verify.status === "PENDING";
    const ok = verify.status === "SUCCEEDED";
    const message = pending ? s.verifying : ok ? s.succeeded : verify.status === "TIMEOUT" ? s.stillPending : verify.status === "FAILED" ? s.failed : s.cancelled;
    return (
      <section className={cn("rounded-2xl p-5 ring-1", ok ? "bg-emerald-50 ring-emerald-200" : pending || verify.status === "TIMEOUT" ? "bg-amber-50 ring-amber-200" : "bg-red-50 ring-red-200")} data-testid="pay-result" data-status={verify.status}>
        <p aria-live="polite" className="flex items-center gap-2.5 text-[1.0625rem] font-semibold">
          {pending ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : ok ? <CheckCircle2 aria-hidden="true" className="size-5" /> : <XCircle aria-hidden="true" className="size-5" />}
          {message}
        </p>
        {pending ? <p className="mt-1.5 text-sm text-stone-700">{s.verifyingHint}</p> : null}
        {!pending ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/t/${token}/siparis/${orderPublicId}`} className="inline-flex min-h-11 items-center rounded-xl bg-stone-900 px-4 font-semibold text-white">
              {s.back}
            </Link>
            {!ok && verify.status !== "TIMEOUT" && available > 0 ? (
              <button type="button" onClick={() => setVerify(null)} className="min-h-11 rounded-xl bg-white px-4 font-semibold ring-1 ring-stone-300" data-testid="pay-retry">
                {s.payCta}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  const modes: Mode[] = ["FULL", "AMOUNT", "EQUAL", "ITEMS"];
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-stone-200" data-testid="pay-panel">
      <div role="radiogroup" aria-label={s.payTitle} className="grid grid-cols-2 gap-2">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn("min-h-12 rounded-xl px-3 text-[0.9375rem] font-semibold ring-1", mode === m ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-800 ring-stone-300")}
            data-testid={`pay-mode-${m.toLowerCase()}`}
          >
            {s.modes[m]}
          </button>
        ))}
      </div>

      {mode === "AMOUNT" ? (
        <label className="mt-5 block">
          <span className="text-sm font-medium text-stone-700">{s.amountLabel}</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="mt-1.5 block min-h-12 w-full rounded-xl px-4 text-[1.125rem] tabular-nums ring-1 ring-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900"
            data-testid="pay-amount"
          />
          <span className="mt-1 block text-xs text-stone-500">{s.amountHint(money(available))}</span>
        </label>
      ) : null}

      {mode === "EQUAL" ? (
        <div className="mt-5">
          <p className="text-sm font-medium text-stone-700">{s.people}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <button type="button" aria-label="-" onClick={() => setPeople((p) => Math.max(2, p - 1))} className="size-12 rounded-xl text-xl ring-1 ring-stone-300">
              −
            </button>
            <span className="min-w-8 text-center text-[1.25rem] font-semibold tabular-nums" data-testid="pay-people">
              {people}
            </span>
            <button type="button" aria-label="+" onClick={() => setPeople((p) => Math.min(20, p + 1))} className="size-12 rounded-xl text-xl ring-1 ring-stone-300" data-testid="pay-people-inc">
              +
            </button>
          </div>
          <p className="mt-2 text-xs text-stone-500">{s.shares(shares.map(money).join(" · "))}</p>
        </div>
      ) : null}

      {mode === "ITEMS" ? (
        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-stone-700">{s.pickItems}</legend>
          <ul className="mt-2 divide-y divide-stone-200/80">
            {lines.map((l) => {
              const q = picked[l.id] ?? 0;
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 py-3" data-testid="pay-item">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{l.name}</p>
                    <p className="text-xs text-stone-500">
                      {l.quantity - l.remainingUnits > 0 ? `${l.quantity - l.remainingUnits}/${l.quantity} ${s.itemsPaid} · ` : ""}
                      {l.nextUnitsAmounts[0] === 0 ? s.free : l.nextUnitsAmounts[0] !== undefined ? money(l.nextUnitsAmounts[0]) : ""}
                    </p>
                  </div>
                  {l.remainingUnits > 0 ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" aria-label={`- ${l.name}`} disabled={q === 0} onClick={() => setPicked((p) => ({ ...p, [l.id]: q - 1 }))} className="size-11 rounded-lg ring-1 ring-stone-300 disabled:opacity-40">
                        −
                      </button>
                      <span className="w-6 text-center tabular-nums">{q}</span>
                      <button type="button" aria-label={`+ ${l.name}`} disabled={q >= l.remainingUnits} onClick={() => setPicked((p) => ({ ...p, [l.id]: q + 1 }))} className="size-11 rounded-lg ring-1 ring-stone-300 disabled:opacity-40" data-testid="pay-item-inc">
                        +
                      </button>
                    </div>
                  ) : (
                    <CheckCircle2 aria-label={s.itemsPaid} className="size-5 shrink-0 text-emerald-700" />
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <div className="mt-5 flex items-baseline justify-between border-t border-stone-200/80 pt-4">
        <span className="text-stone-600">{mode === "EQUAL" ? s.yourShare : mode === "ITEMS" ? s.selected : s.payTitle}</span>
        <span className="text-[1.25rem] font-semibold tabular-nums" data-testid="pay-amount-preview">
          {money(amount > 0 ? amount : 0)}
        </span>
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200" data-testid="pay-error">
          {error}
        </p>
      ) : null}
      <button type="button" disabled={!valid || busy} onClick={pay} className="mt-4 min-h-12 w-full rounded-xl bg-emerald-700 font-semibold text-white disabled:opacity-50" data-testid="pay-submit">
        {busy ? s.starting : s.payButton(money(amount > 0 ? amount : 0))}
      </button>
      <p className="mt-3 text-center text-xs text-stone-500">{s.cardNote}</p>
    </section>
  );
}
