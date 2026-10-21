"use client";

import { AlertTriangle, CheckCircle2, Pencil, ShoppingBag, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ORDER_LIMITS } from "@/lib/orders/calculate";
import { cartItemCount, setQuantity, toSelections, type Cart, type CartLine } from "@/lib/orders/cart";
import { formatOrderNumber } from "@/lib/orders/status";
import { trackMenuEvent } from "@/lib/public-menu/events";
import type { OrderStrings } from "@/lib/public-menu/i18n-order";
import { cn } from "@/lib/utils/cn";
import { checkCartAction, submitOrderAction } from "@/server/actions/order.actions";
import { previewPromotionAction, promotionOptionsAction } from "@/server/actions/promotion-public.actions";
import { promotionStrings } from "@/lib/promotions/i18n";
import type { PromotionRequest } from "@/lib/promotions/engine";
import { PromotionBox, type AppliedPromotion, type RewardOptions } from "@/components/public/cart/promotion-box";
import { QuantityStepper } from "@/components/public/product-sheet";
import type { RecentOrder } from "@/components/public/cart/use-cart";

type LineState = { status: "ok" | "price_changed" | "sold_out" | "unavailable" | "invalid"; fromMinor?: number; toMinor?: number };
type Step = "cart" | "confirm" | "success";
type Success = { publicId: string; number: string; totalMinor: number; discountMinor: number; itemCount: number; tableName: string };

/**
 * Sepet / gözden geçirme / onay / sonuç — tek alttan açılan sayfa.
 * - Açılışta uygunluk ve güncel fiyat sunucudan kontrol edilir (yetkili veri); değişiklikler satırda gösterilir.
 * - "Siparişi Onayla" → son özet → "Siparişi Gönder". Onay adımına girerken bir tekrar-koruma anahtarı üretilir ve
 *   aynı denemenin tüm yeniden denemelerinde AYNEN gönderilir → çift dokunuş / ağ tekrarı tek sipariş oluşturur.
 * - Fiyat değiştiyse toplam asla sessizce değişmez: müşteri "yeni tutarları kabul et" der ve yeniden gönderir.
 */
export function CartSheet({
  open,
  onClose,
  cart,
  update,
  o,
  money,
  locale,
  token,
  tableName,
  onEdit,
  remember,
  initialCheck,
}: {
  open: boolean;
  onClose: () => void;
  cart: Cart | null;
  update: (fn: (c: Cart) => Cart | null) => void;
  o: OrderStrings;
  money: (minor: number) => string;
  locale: string;
  token: string;
  tableName: string;
  onEdit: (line: CartLine) => void;
  remember: (order: RecentOrder) => void;
  initialCheck: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>("cart");
  const [states, setStates] = useState<Map<string, LineState>>(() => new Map());
  const [current, setCurrent] = useState<Map<string, number>>(() => new Map());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  // ─── Promosyon (kupon YA DA ödül; sunucu önizlemesi, tüketim yok) ───
  const ps = promotionStrings(locale);
  const [applied, setApplied] = useState<AppliedPromotion | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [rewardOptions, setRewardOptions] = useState<RewardOptions>(null);
  const idempotencyKey = useRef<string | null>(null);
  const sending = useRef(false);
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

  const lines = cart?.lines ?? [];
  const localTotal = lines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
  const total = applied ? applied.preview.totalMinor : localTotal;
  const count = cart ? cartItemCount(cart) : 0;
  const blocked = lines.some((l) => {
    const s = states.get(l.key)?.status;
    return s === "sold_out" || s === "unavailable" || s === "invalid";
  });
  const priceChanges = lines.filter((l) => states.get(l.key)?.status === "price_changed");

  // Uygunluk kontrolü (açılışta; kullanıcı olayıyla tetiklenen sayaç değişince). Sonuç yetkili değildir — gönderim yeniden doğrular.
  const lastCheck = useRef(0);
  useEffect(() => {
    if (!open || !cart || !cart.lines.length || initialCheck === lastCheck.current) return;
    lastCheck.current = initialCheck;
    let cancelled = false;
    const snapshot = cart.lines;
    void (async () => {
      setChecking(true);
      try {
        const res = await checkCartAction(token, { items: toSelections({ lines: snapshot }), locale });
        if (cancelled || res.kind !== "ok") return;
        const next = new Map<string, LineState>();
        const prices = new Map<string, number>();
        res.lines.forEach((l, i) => {
          const line = snapshot[i];
          if (!line) return;
          next.set(line.key, { status: l.status, fromMinor: l.fromMinor, toMinor: l.toMinor });
          prices.set(line.key, res.currentUnitPrices[i] ?? line.unitPriceMinor);
        });
        setStates(next);
        setCurrent(prices);
      } catch {
        /* çevrimdışı: gönderimde sunucu yine doğrular */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cart, initialCheck, token, locale]);

  // Sepet açıldığında ödül seçenekleri (yalnızca tanınan sadakat üyesine dolu gelir).
  useEffect(() => {
    if (!open || !cart?.lines.length) return;
    let cancelled = false;
    void promotionOptionsAction(token)
      .then((r) => !cancelled && setRewardOptions(r))
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [open, cart?.lines.length, token]);

  const previewFor = async (request: NonNullable<PromotionRequest>, snapshot: Cart) => {
    const r = await previewPromotionAction(token, { items: toSelections(snapshot), locale, promotion: request });
    if (r.kind === "ok") return { ok: true as const, applied: { request, preview: r } };
    return { ok: false as const, error: r.kind === "invalid" ? ps.reasons[r.reason] : r.reason === "rate_limited" ? ps.rateLimited : ps.reasons.invalid };
  };
  const applyPromotion = async (request: NonNullable<PromotionRequest>) => {
    if (!cart || promoBusy) return;
    setPromoBusy(true);
    setPromoError(null);
    try {
      const r = await previewFor(request, cart);
      if (r.ok) {
        lastPromoCart.current = cart.updatedAt;
        setApplied(r.applied);
      } else setPromoError(r.error);
    } catch {
      setPromoError(ps.reasons.invalid);
    } finally {
      setPromoBusy(false);
    }
  };
  // Sepet değişince uygulanan promosyon sunucuda yeniden hesaplanır (tutar asla eski kalmaz).
  const appliedKey = applied ? JSON.stringify(applied.request) : null;
  const lastPromoCart = useRef<number | null>(null);
  useEffect(() => {
    if (!appliedKey || !cart || lastPromoCart.current === cart.updatedAt) return;
    lastPromoCart.current = cart.updatedAt;
    const request = JSON.parse(appliedKey) as NonNullable<PromotionRequest>;
    let cancelled = false;
    void previewPromotionAction(token, { items: toSelections(cart), locale, promotion: request })
      .then((r) => {
        if (cancelled) return;
        if (r.kind === "ok") setApplied({ request, preview: r });
        else {
          setApplied(null);
          setPromoError(r.kind === "invalid" ? ps.reasons[r.reason] : ps.reasons.invalid);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [appliedKey, cart, token, locale, ps]);

  const acceptChanges = () => {
    update((c) => ({ ...c, lines: c.lines.map((l) => (current.has(l.key) && states.get(l.key)?.status === "price_changed" ? { ...l, unitPriceMinor: current.get(l.key)! } : l)) }));
    setStates((s) => new Map([...s].map(([k, v]) => [k, v.status === "price_changed" ? { status: "ok" } : v])));
    setChanged(false);
  };

  const beginCheckout = () => {
    if (!cart || blocked || priceChanges.length) return;
    idempotencyKey.current = newKey();
    setError(null);
    setStep("confirm");
    trackMenuEvent({ type: "begin_checkout", items: count });
  };

  const send = async () => {
    if (!cart || sending.current) return;
    sending.current = true;
    setSubmitting(true);
    setError(null);
    idempotencyKey.current ??= newKey();
    try {
      const res = await submitOrderAction(token, { items: toSelections(cart), note: cart.note || null, idempotencyKey: idempotencyKey.current, locale, promotion: applied?.request ?? null });
      if (res.kind === "created" || res.kind === "duplicate") {
        const number = formatOrderNumber(res.order.orderNumber);
        remember({ publicId: res.order.publicId, number, at: Date.now() });
        setSuccess({ publicId: res.order.publicId, number, totalMinor: res.order.totalMinor, discountMinor: res.order.discountMinor, itemCount: res.order.itemCount, tableName: res.order.tableName });
        setApplied(null);
        setRewardOptions(null);
        trackMenuEvent({ type: "order_submitted", items: res.order.itemCount, duplicate: res.kind === "duplicate" });
        update(() => null);
        idempotencyKey.current = null;
        setStep("success");
      } else if (res.kind === "reconcile") {
        const next = new Map<string, LineState>();
        res.lines.forEach((l, i) => {
          const line = cart.lines[i];
          if (line) next.set(line.key, { status: l.status, fromMinor: l.fromMinor, toMinor: l.toMinor });
        });
        setStates(next);
        setCurrent(new Map(res.lines.flatMap((l, i) => (cart.lines[i] && l.toMinor != null ? [[cart.lines[i]!.key, l.toMinor] as const] : []))));
        setChanged(true);
        setStep("cart");
      } else if (res.kind === "promotion_rejected") {
        // Sipariş OLUŞMADI (kullanım / puan tüketilmedi). Promosyon kaldırılır, müşteri yeniden onaylar.
        setApplied(null);
        setPromoError(`${ps.reasons[res.reason]} ${ps.rejectedAtSubmit}`);
        idempotencyKey.current = newKey();
        setStep("cart");
      } else if (res.kind === "rejected") {
        if (res.reason === "idempotency_conflict" || res.reason === "invalid") idempotencyKey.current = newKey();
        setError(res.reason === "context_invalid" ? o.errorContext : res.reason === "rate_limited" ? o.errorRateLimited : res.reason === "feature_disabled" ? o.errorOrderingUnavailable : o.errorGeneric);
      }
    } catch {
      // Ağ hatası: anahtar KORUNUR — yeniden denemede aynı sipariş (varsa) döner, çift sipariş oluşmaz.
      setError(o.errorGeneric);
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };

  const close = () => ref.current?.close();
  const onDialogClose = () => {
    onClose();
    if (step !== "confirm") setStep("cart");
    if (step === "success") setSuccess(null);
    setConfirmClear(false);
  };

  return (
    <dialog
      ref={ref}
      onClose={onDialogClose}
      onClick={(e) => e.target === ref.current && !submitting && ref.current?.close()}
      onCancel={(e) => submitting && e.preventDefault()}
      aria-labelledby="pm-cart-title"
      className="m-0 mt-auto hidden open:flex max-h-[94dvh] w-full max-w-none flex-col overflow-hidden rounded-t-[1.75rem] bg-[#faf8f5] p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45 open:motion-safe:animate-[pm-sheet-in_260ms_cubic-bezier(0.16,1,0.3,1)] sm:m-auto sm:max-h-[88dvh] sm:max-w-xl sm:rounded-[1.75rem]"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
        <h2 id="pm-cart-title" className="text-[1.25rem] font-semibold tracking-tight">
          {step === "success" ? o.successTitle : step === "confirm" ? o.confirmTitle : o.cartTitle}
        </h2>
        <button type="button" onClick={close} disabled={submitting} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-stone-200/60 disabled:opacity-40">
          <X aria-hidden="true" className="size-5" />
          <span className="sr-only">{o.cancel}</span>
        </button>
      </div>

      {step === "success" && success ? (
        <div className="overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 text-center" data-testid="order-success">
          <CheckCircle2 aria-hidden="true" className="mx-auto mt-2 size-14 text-emerald-600" />
          <p className="mt-4 text-[2rem] font-semibold tracking-tight tabular-nums" data-testid="order-number">
            {success.number}
          </p>
          <p className="mt-1 text-stone-600">
            {success.tableName} · {o.items(success.itemCount)} · <span className="font-semibold tabular-nums text-stone-900">{money(success.totalMinor)}</span>
          </p>
          {success.discountMinor > 0 ? (
            <p className="mt-1 text-sm font-medium text-emerald-800" data-testid="success-discount">
              {ps.discount}: −{money(success.discountMinor)}
            </p>
          ) : null}
          <p className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-200">{o.status.SUBMITTED}</p>
          <div className="mt-7 grid gap-2">
            <Link href={`/t/${token}/siparis/${success.publicId}`} className="flex min-h-12 items-center justify-center rounded-full bg-[var(--pm-brand)] text-[0.9375rem] font-semibold text-[var(--pm-on-brand)]">
              {o.viewOrder}
            </Link>
            <button type="button" onClick={close} className="min-h-12 rounded-full bg-white text-[0.9375rem] font-semibold ring-1 ring-stone-900/10">
              {o.backToMenu}
            </button>
          </div>
        </div>
      ) : !lines.length ? (
        <div className="flex flex-col items-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 text-center">
          <ShoppingBag aria-hidden="true" className="size-10 text-stone-400" />
          <p className="mt-3 font-semibold">{o.cartEmpty}</p>
          <p className="mt-1 text-sm text-stone-500">{o.cartEmptyHint}</p>
        </div>
      ) : step === "confirm" ? (
        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
          <div className="rounded-2xl bg-white p-5 text-center ring-1 ring-stone-200">
            <p className="text-sm font-medium uppercase tracking-[0.1em] text-stone-500">{tableName}</p>
            <p className="mt-2 text-stone-600">{o.items(count)}</p>
            {applied ? (
              <dl className="mx-auto mt-2 grid max-w-xs grid-cols-2 gap-y-1 text-sm" data-testid="confirm-breakdown">
                <dt className="text-start text-stone-500">{ps.subtotal}</dt>
                <dd className="text-end tabular-nums">{money(applied.preview.subtotalMinor)}</dd>
                <dt className="text-start text-emerald-800">{ps.discount}</dt>
                <dd className="text-end tabular-nums text-emerald-800">−{money(applied.preview.discountMinor)}</dd>
              </dl>
            ) : null}
            <p className="mt-1 text-[2rem] font-semibold tabular-nums" data-testid="confirm-total">
              {money(total)}
            </p>
            <p className="mt-3 text-sm text-stone-500">{o.confirmHint}</p>
          </div>
          {error ? <ErrorNote text={error} /> : null}
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={send}
              disabled={submitting}
              aria-busy={submitting}
              data-testid="send-order"
              className="min-h-12 rounded-full bg-[var(--pm-brand)] text-[1rem] font-semibold text-[var(--pm-on-brand)] disabled:opacity-70"
            >
              {submitting ? o.sending : o.sendOrder}
            </button>
            <button type="button" onClick={() => setStep("cart")} disabled={submitting} className="min-h-12 rounded-full bg-white text-[0.9375rem] font-semibold ring-1 ring-stone-900/10">
              {o.back}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            {changed || priceChanges.length || blocked ? (
              <div role="alert" className="mb-3 rounded-2xl bg-amber-50 p-4 text-amber-950 ring-1 ring-amber-200">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle aria-hidden="true" className="size-4" /> {o.changedTitle}
                </p>
                <p className="mt-1 text-sm">{o.changedHint}</p>
                {priceChanges.length ? (
                  <button type="button" onClick={acceptChanges} className="mt-3 min-h-11 rounded-full bg-amber-900 px-4 text-sm font-semibold text-white" data-testid="accept-changes">
                    {o.acceptChanges}
                  </button>
                ) : null}
              </div>
            ) : null}
            {checking ? <p className="mb-2 text-xs text-stone-500" aria-live="polite">{o.checking}</p> : null}
            <ul className="divide-y divide-stone-200/80" aria-label={o.cartTitle}>
              {lines.map((line) => {
                const state = states.get(line.key);
                return (
                  <li key={line.key} className="py-4" data-cart-line={line.product}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-semibold leading-snug">{line.name}</p>
                        {line.detail ? <p className="mt-0.5 break-words text-sm text-stone-600">{line.detail}</p> : null}
                        {line.note ? <p className="mt-1 break-words text-sm italic text-stone-500">“{line.note}”</p> : null}
                        {state && state.status !== "ok" ? (
                          <p className={cn("mt-1.5 text-sm font-semibold", state.status === "price_changed" ? "text-amber-800" : "text-red-700")} data-line-status={state.status}>
                            {state.status === "price_changed" && state.fromMinor != null && state.toMinor != null
                              ? o.linePriceChanged(money(state.fromMinor), money(state.toMinor))
                              : state.status === "sold_out"
                                ? o.lineSoldOut
                                : state.status === "unavailable"
                                  ? o.lineUnavailable
                                  : o.lineInvalid}
                          </p>
                        ) : null}
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums">{money(line.unitPriceMinor * line.quantity)}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <QuantityStepper small value={line.quantity} name={line.name} o={o} onChange={(n) => (n <= 0 ? (update((c) => setQuantity(c, line.key, 0)), trackMenuEvent({ type: "remove_from_cart", product: line.product })) : update((c) => setQuantity(c, line.key, n)))} />
                      <div className="flex gap-1">
                        {state?.status !== "unavailable" ? (
                          <button type="button" onClick={() => onEdit(line)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-stone-200/60">
                            <Pencil aria-hidden="true" className="size-4" /> {o.edit}
                            <span className="sr-only">: {line.name}</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            update((c) => setQuantity(c, line.key, 0));
                            trackMenuEvent({ type: "remove_from_cart", product: line.product });
                          }}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 aria-hidden="true" className="size-4" /> {o.remove}
                          <span className="sr-only">: {line.name}</span>
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2">
              <PromotionBox s={ps} applied={applied} options={applied ? null : rewardOptions} busy={promoBusy} error={promoError} onApply={applyPromotion} onRemove={() => (setApplied(null), setPromoError(null))} />
            </div>
            <div className="mt-4 pb-4">
              <label htmlFor={noteId} className="mb-2 block text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-stone-500">
                {o.orderNote}
              </label>
              <textarea
                id={noteId}
                rows={2}
                maxLength={ORDER_LIMITS.orderNoteMax}
                value={cart?.note ?? ""}
                onChange={(e) => update((c) => ({ ...c, note: e.target.value, updatedAt: Date.now() }))}
                placeholder={o.orderNotePlaceholder}
                className="w-full resize-none rounded-xl bg-white px-3.5 py-3 text-[1rem] ring-1 ring-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[var(--pm-accent)]"
              />
              {confirmClear ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 ring-1 ring-stone-200">
                  <span className="text-sm">{o.clearCartConfirm}</span>
                  <button type="button" onClick={() => (update(() => null), setConfirmClear(false))} className="min-h-10 rounded-full bg-red-700 px-4 text-sm font-semibold text-white">
                    {o.clearCart}
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="min-h-10 rounded-full px-4 text-sm font-medium">
                    {o.cancel}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} className="mt-3 min-h-10 text-sm font-medium text-stone-500 underline underline-offset-4">
                  {o.clearCart}
                </button>
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-stone-200/80 px-5 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3">
            {error ? <ErrorNote text={error} /> : null}
            {applied ? (
              <dl className="mb-1.5 grid grid-cols-2 gap-y-0.5 text-sm" data-testid="cart-breakdown">
                <dt className="text-stone-500">{ps.subtotal}</dt>
                <dd className="text-end tabular-nums" data-testid="cart-subtotal">{money(applied.preview.subtotalMinor)}</dd>
                <dt className="text-emerald-800">{ps.discount}</dt>
                <dd className="text-end tabular-nums text-emerald-800" data-testid="cart-discount">−{money(applied.preview.discountMinor)}</dd>
              </dl>
            ) : null}
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-stone-600">
                {o.total} <span className="text-sm">({o.items(count)})</span>
              </span>
              <span className="text-[1.25rem] font-semibold tabular-nums" data-testid="cart-total">
                {money(total)}
              </span>
            </div>
            <button
              type="button"
              onClick={beginCheckout}
              aria-disabled={blocked || priceChanges.length > 0}
              data-testid="review-order"
              className={cn("min-h-12 w-full rounded-full text-[1rem] font-semibold", blocked || priceChanges.length ? "bg-stone-300 text-stone-600" : "bg-[var(--pm-brand)] text-[var(--pm-on-brand)]")}
            >
              {o.reviewOrder}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="mb-3 mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800 ring-1 ring-red-200">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {text}
    </p>
  );
}

/** Ödeme denemesi anahtarı (tarayıcı CSPRNG). */
function newKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
