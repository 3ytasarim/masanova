"use client";

import { Check, Gift, Tag, X } from "lucide-react";
import { useId, useState } from "react";
import type { PromotionRequest } from "@/lib/promotions/engine";
import type { PromotionStrings } from "@/lib/promotions/i18n";
import { cn } from "@/lib/utils/cn";
import type { PromotionPreview } from "@/server/actions/promotion-public.actions";

export type AppliedPromotion = { request: NonNullable<PromotionRequest>; preview: Extract<PromotionPreview, { kind: "ok" }> };
export type RewardOptions = { balance: number; rewards: { id: string; name: string; description: string | null; pointsCost: number; affordable: boolean }[] } | null;

/**
 * Sepette kupon / ödül. Yazınca uygulanmaz: "Uygula" sunucu ÖNİZLEMESİ ister (tüketim yok). Tek promosyon: kupon
 * uygulanınca ödüller, ödül seçilince kupon alanı kapanır. Gösterilen tutarlar sunucudandır; kesin karar gönderimde.
 */
export function PromotionBox({ s, applied, options, busy, error, onApply, onRemove }: { s: PromotionStrings; applied: AppliedPromotion | null; options: RewardOptions; busy: boolean; error: string | null; onApply: (r: NonNullable<PromotionRequest>) => void; onRemove: () => void }) {
  const id = useId();
  const [code, setCode] = useState("");

  if (applied) {
    const p = applied.preview;
    return (
      <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200" data-testid="promotion-applied" data-kind={applied.request.kind}>
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 items-start gap-2 font-semibold text-emerald-950">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">
              {p.label}
              {applied.request.kind === "coupon" ? <span className="ms-1.5 font-mono text-sm font-medium">({applied.request.code.toUpperCase()})</span> : null}
            </span>
          </p>
          <button type="button" onClick={onRemove} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-emerald-900 hover:bg-emerald-100" data-testid="promotion-remove">
            <X aria-hidden="true" className="size-4" /> {s.remove}
          </button>
        </div>
        {p.freeItemName ? <p className="mt-1 text-sm text-emerald-900">{s.freeItem(p.freeItemName)}</p> : null}
        {p.pointsCost ? <p className="mt-1 text-sm text-emerald-900">{s.pointsUsed(p.pointsCost)}</p> : null}
        <p className="mt-1 text-xs text-emerald-800">{s.estimate}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onApply({ kind: "coupon", code: code.trim() });
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-stone-500">
            <Tag aria-hidden="true" className="size-3.5" /> {s.coupon}
          </label>
          <input
            id={id}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={32}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder={s.couponPlaceholder}
            className="h-12 w-full rounded-xl bg-white px-3.5 font-mono text-[1rem] uppercase ring-1 ring-stone-200 placeholder:normal-case placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[var(--pm-accent)]"
            data-testid="coupon-input"
          />
        </div>
        <button type="submit" disabled={busy || !code.trim()} className="h-12 shrink-0 rounded-xl bg-stone-900 px-5 text-sm font-semibold text-white disabled:opacity-50" data-testid="coupon-apply">
          {busy ? s.applying : s.apply}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700" data-testid="promotion-error">
          {error}
        </p>
      ) : null}
      {options && options.rewards.length ? (
        <section aria-label={s.useRewards} className="rounded-2xl bg-white p-4 ring-1 ring-stone-200" data-testid="reward-options">
          <p className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5 font-semibold">
              <Gift aria-hidden="true" className="size-4" /> {s.useRewards}
            </span>
            <span className="tabular-nums text-stone-600" data-testid="reward-balance" data-points={options.balance}>
              {s.balance(options.balance)}
            </span>
          </p>
          <ul className="mt-3 grid gap-2">
            {options.rewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2.5" data-reward={r.name}>
                <span className="min-w-0">
                  <span className="block break-words text-[0.9375rem] font-medium">{r.name}</span>
                  <span className="text-xs tabular-nums text-stone-500">
                    {s.cost(r.pointsCost)}
                    {r.description ? ` · ${r.description}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={!r.affordable || busy}
                  onClick={() => onApply({ kind: "reward", rewardId: r.id })}
                  className={cn("min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold", r.affordable ? "bg-[var(--pm-brand)] text-[var(--pm-on-brand)]" : "bg-stone-200 text-stone-500")}
                  data-testid="reward-use"
                >
                  {r.affordable ? s.use : s.notEnough}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
