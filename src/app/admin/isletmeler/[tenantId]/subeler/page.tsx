import { MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { countryName } from "@/lib/validation/intl";
import { formatDateTime } from "@/lib/utils/format";
import { listBranchesDetailed } from "@/server/repositories/branch.repository";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Şubeler" };

export default async function TenantBranchesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenant, scope } = await requireSuperAdminTenant((await params).tenantId);
  const branches = await listBranchesDetailed(scope);
  const base = `/admin/isletmeler/${tenant.id}/subeler`;

  return (
    <section aria-labelledby="branches-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="branches-title" className="text-lg font-semibold tracking-tight">
          Şubeler
        </h2>
        <Link href={`${base}/yeni`} className={buttonVariants({ size: "sm" })}>
          <Plus aria-hidden="true" /> Yeni Şube
        </Link>
      </div>
      {branches.length === 0 ? (
        <EmptyState icon={MapPin} title="Şube yok" description="Bu işletmenin henüz şubesi yok." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Şube</TH>
              <TH>Konum</TH>
              <TH>Yerel ayarlar</TH>
              <TH>Durum</TH>
              <TH>Kayıt</TH>
              <TH><span className="sr-only">İşlemler</span></TH>
            </TR>
          </THead>
          <TBody>
            {branches.map((b) => (
              <TR key={b.id}>
                <TD label="Şube">
                  <span className="font-medium text-fg">{b.name}</span>
                  <span className="ml-2 font-mono text-xs text-fg-subtle">{b.slug}</span>
                </TD>
                <TD label="Konum">{[b.district, b.city, countryName(b.country)].filter(Boolean).join(", ")}</TD>
                <TD label="Yerel ayarlar" className="font-mono text-xs">{`${b.currency} · ${b.locale} · ${b.timezone}`}</TD>
                <TD label="Durum">{b.active ? <Badge tone="success" dot>Aktif</Badge> : <Badge dot>Pasif</Badge>}</TD>
                <TD label="Kayıt" className="whitespace-nowrap">{formatDateTime(b.createdAt)}</TD>
                <TD label="İşlemler" className="text-right">
                  <Link href={`${base}/${b.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    Düzenle<span className="sr-only">: {b.name}</span>
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
