import type { Metadata } from "next";
import { ChevronRight, Eye, MapPin, Palette, Plus, Receipt, UserCog } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { countryName, getLocaleOptions } from "@/lib/validation/intl";
import { formatNumber } from "@/lib/utils/format";
import { prisma } from "@/lib/db/prisma";
import { resolveEntitlements } from "@/server/billing/entitlements";
import { updateBusinessGeneralAction } from "@/server/actions/settings.actions";
import { listBranchesDetailed } from "@/server/repositories/branch.repository";
import { TenantGeneralForm } from "@/components/dashboard/tenant-forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Ayarlar" };

/**
 * İşletme ayarları — YALNIZCA işletme sahibi (settings.manage). İşletme adı, varsayılan dil / para birimi / saat
 * dilimi ve şubeler. Super Admin ekranıyla aynı servisler kullanılır. Destek modu salt okunur.
 */
export default async function SettingsPage() {
  const ctx = await requireTenantUser({ permission: "settings.manage" });
  const readOnly = !!ctx.support || ctx.user.role === "SUPER_ADMIN";
  const [tenant, branches, ent] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: ctx.scope.tenantId }, select: { name: true, settings: { select: { defaultLocale: true, defaultCurrency: true, timezone: true } } } }),
    listBranchesDetailed(ctx.scope),
    resolveEntitlements(ctx.scope.tenantId),
  ]);
  const branchLimit = ent.limits.maxBranches;
  const branchFull = branchLimit !== null && branches.length >= branchLimit;

  const shortcuts = [
    { href: "/panel/personel", icon: UserCog, label: "Personel", text: "Hesaplar, roller ve parolalar" },
    { href: "/panel/tema", icon: Palette, label: "Tema & Tasarım", text: "Logo, renkler ve QR menü görünümü" },
    { href: "/panel/abonelik", icon: Receipt, label: "Abonelik", text: "Paket, limitler ve kullanım" },
  ];

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Ayarlar</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">İşletme bilgileri, şubeler, para birimi ve dil.</p>
        {readOnly ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Salt okunur görünüm (destek modu).
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="grid content-start gap-6 xl:col-span-2">
          <Card data-testid="settings-general">
            <CardHeader>
              <CardTitle>İşletme bilgileri</CardTitle>
              <CardDescription>İşletme adı QR menüde, sesli asistanın karşılamasında ve fişlerde kullanılır.</CardDescription>
            </CardHeader>
            <CardContent>
              {readOnly ? (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-fg-subtle">İşletme adı</dt>
                    <dd className="font-medium text-fg">{tenant?.name}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">Dil · para birimi · saat dilimi</dt>
                    <dd className="font-mono text-xs text-fg">{`${tenant?.settings?.defaultLocale ?? "tr"} · ${tenant?.settings?.defaultCurrency ?? "TRY"} · ${tenant?.settings?.timezone ?? "Europe/Istanbul"}`}</dd>
                  </div>
                </dl>
              ) : (
                <TenantGeneralForm
                  action={updateBusinessGeneralAction}
                  options={getLocaleOptions()}
                  defaults={{
                    name: tenant?.name ?? "",
                    defaultLocale: tenant?.settings?.defaultLocale ?? "tr",
                    defaultCurrency: tenant?.settings?.defaultCurrency ?? "TRY",
                    timezone: tenant?.settings?.timezone ?? "Europe/Istanbul",
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card data-testid="settings-branches">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Şubeler</CardTitle>
                <CardDescription>
                  {formatNumber(branches.length)} şube{branchLimit !== null ? ` · paket limiti ${formatNumber(branchLimit)}` : ""}. Pasif şubeler QR menüde ve siparişte görünmez.
                </CardDescription>
              </div>
              {!readOnly && !branchFull ? (
                <Link href="/panel/ayarlar/subeler/yeni" className={buttonVariants({ size: "sm" })} data-testid="branch-add">
                  <Plus aria-hidden="true" /> Yeni şube
                </Link>
              ) : null}
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              {branches.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-fg-subtle">Henüz şube yok.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Şube</TH>
                      <TH>Konum</TH>
                      <TH>Yerel ayarlar</TH>
                      <TH>Durum</TH>
                      <TH>
                        <span className="sr-only">İşlemler</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {branches.map((b) => (
                      <TR key={b.id}>
                        <TD label="Şube">
                          <span className="inline-flex items-center gap-2 font-medium text-fg">
                            <MapPin aria-hidden="true" className="size-4 text-fg-subtle" />
                            {b.name}
                          </span>
                        </TD>
                        <TD label="Konum">{[b.district, b.city, countryName(b.country)].filter(Boolean).join(", ")}</TD>
                        <TD label="Yerel ayarlar" className="font-mono text-xs">{`${b.currency} · ${b.locale} · ${b.timezone}`}</TD>
                        <TD label="Durum">
                          {b.active ? (
                            <Badge tone="success" dot>
                              Aktif
                            </Badge>
                          ) : (
                            <Badge dot>Pasif</Badge>
                          )}
                        </TD>
                        <TD label="İşlemler" className="text-right">
                          {!readOnly ? (
                            <Link href={`/panel/ayarlar/subeler/${b.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                              Düzenle<span className="sr-only">: {b.name}</span>
                            </Link>
                          ) : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {branchFull && !readOnly ? <p className="px-5 py-4 text-sm text-fg-subtle">Paketinizin şube limitine ulaşıldı. Yeni şube için paketinizi yükseltin.</p> : null}
            </CardContent>
          </Card>
        </div>

        <nav aria-label="Diğer ayarlar" className="grid content-start gap-3">
          {shortcuts.map(({ href, icon: Icon, label, text }) => (
            <Link key={href} href={href} className="group flex min-h-16 items-center gap-3 rounded-xl border border-border bg-bg px-4 py-3 transition-colors hover:bg-surface-2">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="grid flex-1">
                <span className="text-sm font-medium text-fg">{label}</span>
                <span className="text-[0.8125rem] text-fg-subtle">{text}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
