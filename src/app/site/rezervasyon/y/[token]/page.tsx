import type { Metadata } from "next";
import { CalendarDays, MapPin, MessageSquare, Users } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { reservationStrings } from "@/lib/reservations/i18n";
import { canCustomerCancel } from "@/lib/reservations/status";
import { isManageTokenFormat } from "@/lib/reservations/rules";
import { getTenantContext } from "@/lib/tenant/tenant-context";
import { findByManageToken } from "@/server/reservations/booking.service";
import { getPolicy } from "@/server/reservations/context";
import { CancelReservationButton } from "@/components/reservations/public/cancel-button";

/**
 * Müşteri rezervasyon yönetimi — /rezervasyon/y/<belirteç> (kiracı alan adı). Belirteç 256 bit; sunucuda yalnızca
 * özeti aranır ve KİRACI ile eşleşmelidir (başka restoranın alan adında açılmaz). İç not / masa / müşteri kimliği
 * gösterilmez. Adres Referer ile sızmasın diye no-referrer.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rezervasyon", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function ManageReservationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getTenantContext();
  if (ctx.kind !== "tenant" || !isManageTokenFormat(token)) notFound();
  const r = await findByManageToken(ctx.tenant.id, token);
  if (!r) notFound();
  const ui = r.locale === "tr" ? "tr" : "en";
  const s = reservationStrings(ui);
  const policy = await getPolicy(ctx.tenant.id);
  const cancellable = canCustomerCancel(r, new Date(), policy.cancellationCutoffMinutes);
  const when = new Intl.DateTimeFormat(ui === "tr" ? "tr-TR" : "en-GB", { dateStyle: "full", timeStyle: "short", timeZone: r.branch.timezone }).format(r.startsAt);

  return (
    <div lang={ui} className="min-h-dvh bg-[#faf8f5] text-stone-900">
      <main className="mx-auto max-w-xl px-4 pb-16 pt-8">
        <p className="text-[0.8125rem] font-medium uppercase tracking-[0.12em] text-stone-500">{ctx.tenant.name}</p>
        <h1 className="mt-1 text-[1.875rem] font-semibold tracking-tight">{s.manageTitle}</h1>
        <section className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-stone-200" data-testid="manage-reservation" data-status={r.status}>
          <p className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold" data-testid="manage-status">
            {s.status[r.status]}
          </p>
          <p className="mt-4 text-[1.125rem] font-semibold">{r.guestName}</p>
          <dl className="mt-3 grid gap-3 text-[0.9375rem]">
            <div className="flex items-start gap-2.5">
              <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-stone-500" />
              <div>
                <dt className="sr-only">{s.when}</dt>
                <dd className="capitalize">{when}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-stone-500" />
              <div>
                <dt className="sr-only">{s.guests}</dt>
                <dd>{s.partyValue(r.partySize)}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-stone-500" />
              <div>
                <dt className="sr-only">{s.place}</dt>
                <dd>
                  {r.branch.name}
                  {r.preferredArea ? ` · ${r.preferredArea.name}` : ""}
                  {r.branch.address ? <span className="block text-sm text-stone-500">{r.branch.address}</span> : null}
                </dd>
              </div>
            </div>
            {r.specialRequest ? (
              <div className="flex items-start gap-2.5">
                <MessageSquare aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-stone-500" />
                <div>
                  <dt className="text-sm text-stone-500">{s.yourRequest}</dt>
                  <dd className="whitespace-pre-line break-words">{r.specialRequest}</dd>
                </div>
              </div>
            ) : null}
          </dl>
          {cancellable ? <CancelReservationButton token={token} locale={ui} /> : r.status === "PENDING" || r.status === "CONFIRMED" ? <p className="mt-6 text-sm text-stone-600">{s.cutoff}</p> : null}
        </section>
        <Link href="/rezervasyon" className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-stone-700 underline-offset-4 hover:underline">
          {s.newBooking}
        </Link>
      </main>
    </div>
  );
}
