import type { Metadata } from "next";
import { CalendarX } from "lucide-react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_PARAM, pickPublicLocale } from "@/lib/public-menu/i18n";
import { reservationStrings } from "@/lib/reservations/i18n";
import { addDays, localParts } from "@/lib/reservations/time";
import { getTenantContext } from "@/lib/tenant/tenant-context";
import { getPolicy } from "@/server/reservations/context";
import { maxSeatable } from "@/lib/reservations/availability";
import { loadBranchContext } from "@/server/reservations/context";
import { ReservationBooking, type BookingBranch } from "@/components/reservations/public/reservation-booking";
import { checkFeature } from "@/server/billing/entitlements";

/**
 * Public rezervasyon — kiracı alan adında /rezervasyon (proxy → /site/rezervasyon). Panel altında DEĞİL; hesap gerekmez.
 * Kiracı yalnızca host'tan. Uygunluk sunucuda hesaplanır; nihai karar oluşturma anındaki kilitli yeniden denetimdir.
 */
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getTenantContext();
  return { title: { absolute: ctx.kind === "tenant" ? `Rezervasyon · ${ctx.tenant.name}` : "Rezervasyon" }, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ReservationPage({ searchParams }: Props) {
  const ctx = await getTenantContext();
  if (ctx.kind !== "tenant") notFound();
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultLocale: true } });
  const query = sp[PUBLIC_LOCALE_PARAM];
  const locale = pickPublicLocale({ query: typeof query === "string" ? query : null, cookie: (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value ?? null, tenantDefault: settings?.defaultLocale ?? "tr" });
  const ui = locale === "tr" ? "tr" : "en";
  const s = reservationStrings(ui);
  const policy = await getPolicy(tenantId);
  const entitled = (await checkFeature(tenantId, "reservations")).allowed;

  if (!policy.enabled || !policy.publicBookingEnabled || !entitled) {
    return (
      <main lang={ui} className="flex min-h-dvh items-center justify-center bg-[#faf8f5] px-4">
        <div className="max-w-sm text-center">
          <CalendarX aria-hidden="true" className="mx-auto size-10 text-stone-400" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-stone-900">{ctx.tenant.name}</h1>
          <p className="mt-2 text-stone-600" data-testid="reservations-disabled">
            {s.disabled}
          </p>
        </div>
      </main>
    );
  }

  const rows = await prisma.branch.findMany({ where: { tenantId, active: true }, orderBy: { name: "asc" }, select: { id: true, slug: true, name: true, phone: true } });
  const branches: BookingBranch[] = [];
  for (const b of rows) {
    const bc = await loadBranchContext(tenantId, b.id);
    if (!bc) continue;
    const maxOnline = Math.min(policy.maxPartySize, maxSeatable(bc.tables, bc.combinations));
    // Masası ya da açılış saati olmayan şube müşteriye gösterilmez.
    if (maxOnline < policy.minPartySize || bc.hoursByWeekday.size === 0) continue;
    const today = localParts(new Date(), bc.branch.timeZone).date;
    branches.push({
      slug: b.slug,
      name: b.name,
      phone: b.phone,
      today,
      lastDate: addDays(today, policy.maxAdvanceDays),
      areas: bc.areas,
      maxOnline,
      openWeekdays: [...bc.hoursByWeekday.keys()],
    });
  }
  if (!branches.length) {
    return (
      <main lang={ui} className="flex min-h-dvh items-center justify-center bg-[#faf8f5] px-4">
        <p className="max-w-sm text-center text-stone-600" data-testid="reservations-disabled">
          {s.disabled}
        </p>
      </main>
    );
  }

  return (
    <div lang={ui} className="min-h-dvh bg-[#faf8f5] text-stone-900">
      <main className="mx-auto max-w-xl px-4 pb-16 pt-8">
        <p className="text-[0.8125rem] font-medium uppercase tracking-[0.12em] text-stone-500">{ctx.tenant.name}</p>
        <h1 className="mt-1 text-[1.875rem] font-semibold tracking-tight">{s.title}</h1>
        <p className="mt-1.5 text-stone-600">{s.intro}</p>
        <ReservationBooking locale={ui} branches={branches} minParty={policy.minPartySize} />
      </main>
    </div>
  );
}
