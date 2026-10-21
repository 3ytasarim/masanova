"use client";

import { Gift, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { customerStrings } from "@/lib/crm/i18n";

/**
 * Sipariş sonrası sakin davet (açılır pencere DEĞİL; menüyü engellemez). "Şimdi değil" bu tarayıcıda 30 gün gizler —
 * yalnızca görünüm tercihi (localStorage); kimlik ya da izleme verisi değildir. Depolama yoksa davet yine kapatılabilir.
 */
const KEY = "mn_crm_invite_hidden_until";
const HIDE_MS = 30 * 86_400_000;

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
function storedHidden(): boolean {
  try {
    return Number(window.localStorage.getItem(KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function LoyaltyInvite({ href, locale, loyalty }: { href: string; locale: string; loyalty: boolean }) {
  const c = customerStrings(locale);
  // Sunucu HTML'i davetsiz başlar (tercih yalnızca tarayıcıda bilinir); istemcide depolamaya göre gösterilir.
  const hidden = useSyncExternalStore(subscribe, storedHidden, () => true);
  const [dismissed, setDismissed] = useState(false);
  if (hidden || dismissed) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, String(Date.now() + HIDE_MS));
    } catch {
      /* depolama yok: yalnızca bu görünümde gizlenir */
    }
    setDismissed(true);
  };

  return (
    <aside aria-labelledby="crm-invite-title" className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-stone-200" data-testid="loyalty-invite">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <Gift className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p id="crm-invite-title" className="font-semibold text-stone-900">
            {loyalty ? c.inviteTitle : c.inviteTitleNoLoyalty}
          </p>
          <p className="mt-1 text-sm text-stone-600">{c.inviteBody}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={href} className="inline-flex min-h-11 items-center rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white" data-testid="invite-accept">
              {c.inviteAccept}
            </Link>
            <button type="button" onClick={dismiss} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50" data-testid="invite-dismiss">
              {c.inviteDismiss}
            </button>
          </div>
        </div>
        <button type="button" onClick={dismiss} aria-label={c.inviteDismiss} className="-me-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </aside>
  );
}
