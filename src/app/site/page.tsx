import type { Metadata } from "next";
import { CalendarClock, QrCode } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext, requireTenant } from "@/lib/tenant/tenant-context";
import { listBranches } from "@/server/repositories/branch.repository";
import { getPolicy } from "@/server/reservations/context";
import { LogoMark } from "@/components/layout/logo";
import { cookies } from "next/headers";
import { PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_PARAM, pickPublicLocale } from "@/lib/public-menu/i18n";
import { getCachedPublicPresentation, getCachedPublishedMenu } from "@/server/services/public-menu/public-menu-cache";
import { toPublicMenuView } from "@/server/services/public-menu/serialize";
import { createMenuRefs } from "@/server/services/orders/menu-refs";
import { loadVenue } from "@/server/services/public-menu/venue";
import { getVoiceAiAccess } from "@/server/services/ai/access.service";
import { PublicMenu } from "@/components/public/public-menu";

/**
 * Kiracı public sitesi: menünün yalnızca görüntüleme hâli (sipariş / sesli garson masadaki QR'dan). proxy.ts, kiracı alan adından gelen istekleri buraya rewrite eder:
 *   demo.localhost:3000/  →  /site
 * Platform alan adından doğrudan /site çağrılırsa kiracı çözümlenmez → 404.
 */

export async function generateMetadata(): Promise<Metadata> {
  const context = await getTenantContext();
  const title = context.kind === "tenant" ? context.tenant.name : "MasaNova AI";
  // QR menü yayına girene kadar kiracı siteleri dizine eklenmez.
  return { title: { absolute: title }, robots: { index: false, follow: false } };
}

export default async function TenantSitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getTenantContext();
  if (context.kind === "unavailable") return <TenantUnavailable name={context.tenant.name} />;
  if (context.kind !== "tenant") notFound();

  const { tenant, scope } = await requireTenant();
  const branches = await listBranches(scope, { activeOnly: true });
  const reservations = await getPolicy(tenant.id);

  // İşletme ana sayfası = menünün YALNIZCA GÖRÜNTÜLEME hâli (masa yok → sepet / sipariş / sesli garson yok).
  // Sipariş ve sesli garson masadaki QR'dan açılan /t/<token> sayfasında (masa güvenilir bağlamdan gelir).
  const presentation = await getCachedPublicPresentation(scope);
  const query = (await searchParams)[PUBLIC_LOCALE_PARAM];
  const locale = pickPublicLocale({ query: typeof query === "string" ? query : null, cookie: (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value ?? null, tenantDefault: presentation.defaultLocale });
  const branchId = branches[0]?.id ?? null;
  const menu = await getCachedPublishedMenu(scope, { branchId, locale });
  const view = toPublicMenuView(menu, presentation, { table: null, refOf: createMenuRefs(tenant.id), ordering: null });
  const venue = await loadVenue(tenant.id, branchId, tenant.name, presentation.googleReviewUrl);
  const ai = (await getVoiceAiAccess(tenant.id)).availability.available;

  const notice = (
    <div className="flex flex-col gap-2">
      <p data-testid="site-qr-hint" className="flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-[0.875rem] leading-relaxed text-amber-950 ring-1 ring-amber-200">
        <QrCode aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{ai ? "Sipariş vermek ve sesli garsonla konuşmak için masanızdaki QR kodu okutun." : "Sipariş vermek için masanızdaki QR kodu okutun."}</span>
      </p>
      {reservations.enabled && reservations.publicBookingEnabled ? (
        <Link href="/rezervasyon" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--pm-brand)] px-5 font-semibold text-[var(--pm-on-brand)] shadow-sm" data-testid="site-reservation-link">
          <CalendarClock aria-hidden="true" className="size-5" /> Rezervasyon yap
        </Link>
      ) : null}
    </div>
  );

  return <PublicMenu view={view} venue={venue} notice={notice} capabilities={{ ordering: false, service: false }} />;
}

function TenantUnavailable({ name }: { name: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-2 max-w-sm text-sm text-fg-subtle">Bu işletmenin dijital menüsü şu anda hizmet vermiyor.</p>
      <PoweredBy />
    </main>
  );
}

function PoweredBy() {
  return (
    <footer className="flex items-center justify-center gap-2 py-6 text-xs text-fg-subtle">
      <LogoMark className="size-4" />
      MasaNova AI altyapısıyla
    </footer>
  );
}
