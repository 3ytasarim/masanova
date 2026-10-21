import { Users } from "lucide-react";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/permissions/roles";
import { formatDateTime } from "@/lib/utils/format";
import { listTenantUsers } from "@/server/repositories/user.repository";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Kullanıcılar" };

export default async function TenantUsersPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { scope } = await requireSuperAdminTenant((await params).tenantId);
  const users = await listTenantUsers(scope);

  return (
    <section aria-labelledby="users-title">
      <div className="mb-4">
        <h2 id="users-title" className="text-lg font-semibold tracking-tight">
          Kullanıcılar
        </h2>
        <p className="mt-1 text-sm text-fg-subtle">Personel ekleme, rol değişikliği ve parola sıfırlama işletme panelindeki Personel bölümünden yapılır.</p>
      </div>
      {users.length === 0 ? (
        <EmptyState icon={Users} title="Kullanıcı yok" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Ad soyad</TH>
              <TH>E-posta</TH>
              <TH>Rol</TH>
              <TH>Durum</TH>
              <TH>Kayıt</TH>
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD label="Ad soyad" className="font-medium text-fg">{`${u.firstName} ${u.lastName}`}</TD>
                <TD label="E-posta" className="break-all">{u.email}</TD>
                <TD label="Rol"><Badge tone={u.role === "TENANT_OWNER" ? "accent" : "neutral"}>{ROLE_LABELS[u.role]}</Badge></TD>
                <TD label="Durum">{u.active ? <Badge tone="success" dot>Aktif</Badge> : <Badge dot>Pasif</Badge>}</TD>
                <TD label="Kayıt" className="whitespace-nowrap">{formatDateTime(u.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
