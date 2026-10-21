import { requireTenantUser } from "@/lib/auth/guards";
import { FeatureSection } from "@/components/billing/feature-gate";

/**
 * Yetki denetimi loading.tsx sınırının DIŞINDA (aksi halde notFound() 200 ile dönerdi): rezervasyon yetkisi olmayan
 * rol (mutfak, bar) gerçek 404 alır. Sayfalar kendi yetkilerini (manage / override / settings) ayrıca denetler.
 */
export default async function ReservationsLayout({ children }: { children: React.ReactNode }) {
  await requireTenantUser({ permission: "reservations.view" });
  return <FeatureSection feature="reservations" mode="continue">{children}</FeatureSection>;
}
