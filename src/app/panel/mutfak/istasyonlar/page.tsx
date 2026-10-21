import type { Metadata } from "next";
import { ArrowLeft, Eye } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import type { StationTypeKey } from "@/lib/validation/stations";
import { listStationsByBranch } from "@/server/repositories/kds.repository";
import { StationsManager } from "@/components/kds/stations-manager";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Hazırlama İstasyonları" };

/** İstasyon ayarları — görüntüleme kds.view; değiştirme stations.manage + yazma (sahip / müdür). */
export default async function StationsPage() {
  const ctx = await requireTenantUser({ permission: "kds.view" });
  const canManage = !ctx.support && hasPermission(ctx.user.role, "stations.manage");
  const branches = await listStationsByBranch(ctx.scope);
  return (
    <>
      <Link href="/panel/mutfak" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft aria-hidden="true" /> Mutfak ekranı
      </Link>
      <header className="pb-6 pt-2">
        <h1 className="text-title font-semibold text-fg">Hazırlama İstasyonları</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">
          Kabul edilen siparişin her ürünü, atandığı istasyona fiş olarak gider (ör. içecekler Bar&apos;a). Ataması olmayan ürünler şubenin varsayılan istasyonuna düşer. Ürün atamaları: Menü › Ürün › İstasyonlar.
        </p>
        {!canManage ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Salt okunur görünüm — istasyonları yönetme yetkiniz yok.
          </p>
        ) : null}
      </header>
      <StationsManager
        canManage={canManage}
        branches={branches.map((b) => ({
          id: b.id,
          name: b.active ? b.name : `${b.name} (pasif şube)`,
          active: b.active,
          defaultStationId: b.defaultStationId,
          stations: b.stations.map((s) => ({ id: s.id, name: s.name, type: s.type as StationTypeKey, active: s.active, productCount: s._count.products })),
        }))}
      />
    </>
  );
}
