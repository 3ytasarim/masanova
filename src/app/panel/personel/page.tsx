import type { Metadata } from "next";
import { Eye, Users } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/permissions/roles";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { resolveEntitlements } from "@/server/billing/entitlements";
import { changeOwnPasswordAction, createStaffAction, resetStaffPasswordAction, updateStaffAction } from "@/server/actions/staff.actions";
import { assignableRoles, canManageStaff, listStaff } from "@/server/services/staff.service";
import { AddStaffButton, EditStaffButton, OwnPasswordForm, ResetPasswordButton, StaffStatus, type StaffView } from "@/components/staff/staff-manager";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Personel" };

/**
 * Personel hesapları: ekleme (geçici ya da belirlenen parola), rol / ad / aktiflik düzenleme, parola sıfırlama.
 * İşletme sahibi tüm personel rollerini, şube müdürü yalnızca operasyon rollerini yönetir; sahip hesabı ve kişinin
 * kendi hesabı listede görünür ama buradan değiştirilemez. Destek modu salt okunur.
 */
export default async function StaffPage() {
  const ctx = await requireTenantUser({ permission: "staff.manage" });
  const readOnly = !!ctx.support || ctx.user.role === "SUPER_ADMIN";
  const [rows, ent] = await Promise.all([listStaff(ctx.scope), resolveEntitlements(ctx.scope.tenantId)]);
  const roles = readOnly ? [] : assignableRoles(ctx.user.role);
  const activeCount = rows.filter((r) => r.active).length;
  const limit = ent.limits.maxStaffUsers;
  const full = limit !== null && activeCount >= limit;

  const staff: StaffView[] = rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    role: r.role,
    active: r.active,
    lastSeen: r.lastSeenAt ? formatDateTime(r.lastSeenAt) : null,
    isSelf: r.id === ctx.user.id,
    manageable: !readOnly && canManageStaff({ userId: ctx.user.id, role: ctx.user.role }, r),
  }));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <h1 className="text-title font-semibold text-fg">Personel</h1>
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Ekibinizin panel hesapları ve rolleri. Her personel yalnızca rolünün izin verdiği bölümleri görür.</p>
          <p className="mt-2 text-sm text-fg-muted" data-testid="staff-usage">
            Aktif personel: <span className="font-semibold tabular-nums text-fg">{formatNumber(activeCount)}</span>
            {limit !== null ? <span className="tabular-nums"> / {formatNumber(limit)} (paket limiti)</span> : " (sınırsız)"}
          </p>
          {readOnly ? (
            <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
              <Eye aria-hidden="true" className="size-4" /> Salt okunur görünüm (destek modu).
            </p>
          ) : null}
        </div>
        {roles.length > 0 ? <AddStaffButton action={createStaffAction} roles={roles} disabledReason={full ? "Paket personel limitine ulaşıldı." : undefined} /> : null}
      </header>

      <section aria-label="Personel listesi" data-testid="staff-list">
        {staff.length === 0 ? (
          <EmptyState icon={Users} title="Personel yok" description="İlk personelinizi ekleyin." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Ad soyad</TH>
                <TH>E-posta</TH>
                <TH>Rol</TH>
                <TH>Durum</TH>
                <TH>Son etkinlik</TH>
                <TH>
                  <span className="sr-only">İşlemler</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {staff.map((s) => (
                <TR key={s.id} data-testid="staff-row" data-email={s.email}>
                  <TD label="Ad soyad" className="font-medium text-fg">
                    {`${s.firstName} ${s.lastName}`}
                    {s.isSelf ? <span className="ml-2 text-xs font-normal text-fg-subtle">(siz)</span> : null}
                  </TD>
                  <TD label="E-posta" className="break-all">
                    {s.email}
                  </TD>
                  <TD label="Rol">
                    <Badge tone={s.role === "TENANT_OWNER" ? "accent" : s.role === "BRANCH_MANAGER" ? "info" : "neutral"}>{ROLE_LABELS[s.role]}</Badge>
                  </TD>
                  <TD label="Durum">
                    <StaffStatus active={s.active} />
                  </TD>
                  <TD label="Son etkinlik" className="whitespace-nowrap text-fg-muted">
                    {s.lastSeen ?? "—"}
                  </TD>
                  <TD label="İşlemler" className="text-right">
                    {s.manageable ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        <EditStaffButton staff={s} roles={roles} action={updateStaffAction.bind(null, s.id)} />
                        <ResetPasswordButton staff={s} action={resetStaffPasswordAction.bind(null, s.id)} />
                      </div>
                    ) : (
                      <span className="text-xs text-fg-subtle">{s.isSelf ? "Kendi hesabınız" : s.role === "TENANT_OWNER" ? "İşletme sahibi" : "Yetki dışı"}</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {!readOnly ? (
        <Card className="mt-8 max-w-xl">
          <CardHeader>
            <CardTitle>Parolamı değiştir</CardTitle>
            <CardDescription>Kendi hesabınızın parolası. Değişiklikten sonra diğer cihazlardaki oturumlarınız kapanır.</CardDescription>
          </CardHeader>
          <CardContent>
            <OwnPasswordForm action={changeOwnPasswordAction} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
