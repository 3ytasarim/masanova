import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { isValidDate, localParts } from "@/lib/reservations/time";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { createStaffReservationAction } from "@/server/actions/reservation.actions";
import { loadBranchContext } from "@/server/reservations/context";
import { panelBranches } from "@/server/reservations/queries.service";
import { StaffReservationForm } from "@/components/reservations/panel/reservation-forms";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Yeni rezervasyon" };

/** Personel rezervasyonu (telefon / yerinde). Aynı uygunluk motoru; kural aşma yalnızca sahip / müdür. */
export default async function NewReservationPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireTenantUser({ permission: "reservations.manage" });
  if (ctx.support) notFound();
  const params = await searchParams;
  const branches = await panelBranches(ctx.scope);
  const branch = branches.find((b) => b.id === param(params, "sube", 40)) ?? branches[0];
  if (!branch) notFound();
  const raw = param(params, "gun", 10);
  const date = raw && isValidDate(raw) ? raw : localParts(new Date(), branch.timezone).date;
  const bc = await loadBranchContext(ctx.scope.tenantId, branch.id);
  return (
    <>
      <Link href={`/panel/rezervasyonlar?sube=${branch.id}&gun=${date}`} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" /> Rezervasyonlar
      </Link>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Yeni rezervasyon</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">{branch.name} · masa uygunluğa göre otomatik atanır.</p>
      </header>
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <StaffReservationForm action={createStaffReservationAction} branchId={branch.id} date={date} areas={bc?.areas ?? []} canOverride={hasPermission(ctx.user.role, "reservations.override")} />
        </CardContent>
      </Card>
    </>
  );
}
