"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reservationStrings } from "@/lib/reservations/i18n";
import { cancelReservationByTokenAction } from "@/server/actions/reservation-public.actions";

export function CancelReservationButton({ token, locale }: { token: string; locale: string }) {
  const s = reservationStrings(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={pending}
        data-testid="manage-cancel"
        onClick={async () => {
          if (!window.confirm(s.cancelConfirm)) return;
          setPending(true);
          const r = await cancelReservationByTokenAction(token).catch(() => null);
          setPending(false);
          if (r?.ok) {
            setMessage(s.cancelled);
            router.refresh();
          } else setMessage(r?.reason === "cutoff" ? s.cutoff : r?.reason === "rate_limited" ? s.rateLimited : s.notFound);
        }}
        className="min-h-12 w-full rounded-xl px-4 font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50"
      >
        {s.cancel}
      </button>
      {message ? (
        <p role="status" className="mt-3 text-sm font-medium text-stone-700" data-testid="manage-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
