/* eslint-disable @next/next/no-img-element -- QR önizlemesi oturumlu, önbelleksiz SVG uç noktasından gelir */
import { ArrowLeft, Download, Printer, QrCode } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { tableIdSchema } from "@/lib/validation/tables";
import { tableQrAction, updateTableAction } from "@/server/actions/tables.actions";
import { getTableDetail, listBranchAreas } from "@/server/repositories/tables.repository";
import { REVEAL_FAILURE_MESSAGES, revealTableQr } from "@/server/services/tables/qr.service";
import { getTablesPageContext } from "@/server/tables-page-context";
import { hasPermission } from "@/lib/permissions/roles";
import { formatDurationShort } from "@/lib/service-requests/timing";
import { SERVICE_STATUS_LABELS, SERVICE_STATUS_TONES, SERVICE_TYPE_LABELS } from "@/lib/service-requests/types";
import { getTableServiceSummary } from "@/server/repositories/service-requests.repository";
import { CopyValue } from "@/components/dashboard/domains/domain-actions";
import { QrActionButton, TableEditForm } from "@/components/tables/table-detail";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Masa" };

export default async function TableDetailPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { scope, canManage, user, support } = await getTablesPageContext();
  const id = tableIdSchema.safeParse((await params).tableId);
  if (!id.success) notFound();
  const table = await getTableDetail(scope, id.data);
  if (!table) notFound();
  const [areas, revealed] = await Promise.all([listBranchAreas(scope, table.branch.id), canManage ? revealTableQr(scope, table.id) : null]);
  const active = table.qrTokens.find((t) => t.active) ?? null;
  const showService = hasPermission(support ? "TENANT_OWNER" : user.role, "service.view");
  const service = showService ? await getTableServiceSummary(scope, table.id) : null;
  const qrAction = tableQrAction.bind(null, table.id);
  const qrBase = `/panel/masalar/indir/qr?masa=${table.id}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href={`/panel/masalar?sube=${table.branch.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft aria-hidden="true" /> Masalar
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">{table.name}</h2>
        <span className="text-sm text-fg-subtle">
          {table.branch.name}
          {table.area ? ` · ${table.area.name}` : " · Bölgesiz"}
        </span>
        {!table.active ? <Badge tone="warning">Pasif</Badge> : null}
        {table.area && !table.area.active ? <Badge tone="warning">Bölge pasif</Badge> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Masa bilgileri</CardTitle>
            <CardDescription>Ad ve numara yalnızca görüntü bilgisidir; QR adresi tahmin edilemez bir kod kullanır.</CardDescription>
          </CardHeader>
          <CardContent>
            {canManage ? (
              <TableEditForm
                action={updateTableAction.bind(null, table.id)}
                areas={areas}
                defaults={{ name: table.name, number: table.number, code: table.code, capacity: table.capacity, capacityMin: table.capacityMin, reservable: table.reservable, areaId: table.diningAreaId, active: table.active }}
              />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <ReadOnly label="Numara" value={table.number?.toString() ?? "—"} />
                <ReadOnly label="İç kod" value={table.code ?? "—"} />
                <ReadOnly label="Kapasite" value={table.capacity ? `${table.capacity} kişi` : "—"} />
                <ReadOnly label="Bölge" value={table.area?.name ?? "Bölgesiz"} />
              </dl>
            )}
          </CardContent>
        </Card>

        <Card aria-labelledby="qr-title">
          <CardHeader>
            <CardTitle id="qr-title" className="flex items-center gap-2">
              <QrCode aria-hidden="true" className="size-5" /> QR kodu
              {active ? <Badge tone="success">Etkin</Badge> : <Badge tone="warning">Yok</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {active ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <ReadOnly label="Oluşturuldu" value={formatDateTime(active.createdAt)} />
                <ReadOnly label="Okutma" value={formatNumber(active.scanCount)} />
                <ReadOnly label="Son okutma" value={active.lastUsedAt ? formatDateTime(active.lastUsedAt) : "Henüz yok"} className="col-span-2" />
              </dl>
            ) : (
              <p className="text-sm text-fg-muted">Bu masanın etkin bir QR kodu yok. {canManage ? "Oluşturduğunuzda tahmin edilemez, masaya özel bir adres üretilir." : ""}</p>
            )}

            {canManage && active && revealed ? (
              revealed.ok ? (
                <>
                  <div className="mx-auto w-full max-w-[14rem] rounded-lg border border-border bg-white p-2">
                    <img src={`${qrBase}&bicim=svg&gorunum=1&v=${active.id}`} alt={`${table.name} QR kodu. Adres aşağıda metin olarak yer alıyor.`} width={224} height={224} className="aspect-square w-full" />
                  </div>
                  <div className="grid gap-1.5">
                    <p className="text-sm font-medium" id="qr-url-label">
                      Kararlı QR adresi
                    </p>
                    <CopyValue value={revealed.qr.url} label="QR adresi" />
                    <p className="text-xs text-fg-subtle">Etiketler bu adresi kodlar; işletmenin alan adı değişse de basılı QR çalışmaya devam eder.</p>
                    <a href={revealed.qr.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-fg underline underline-offset-4">
                      Adresi yeni sekmede aç<span className="sr-only"> (yeni sekme)</span>
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={`${qrBase}&bicim=svg`} download className={buttonVariants({ variant: "secondary", size: "sm" })}>
                      <Download aria-hidden="true" /> SVG
                    </a>
                    <a href={`${qrBase}&bicim=png`} download className={buttonVariants({ variant: "secondary", size: "sm" })}>
                      <Download aria-hidden="true" /> PNG
                    </a>
                    <Link href={`/panel/masalar/etiketler?sube=${table.branch.id}&masa=${table.id}`} className={buttonVariants({ size: "sm", className: "col-span-2" })}>
                      <Printer aria-hidden="true" /> Etiket tasarla ve bas
                    </Link>
                  </div>
                </>
              ) : (
                <p role="alert" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                  {REVEAL_FAILURE_MESSAGES[revealed.reason]}
                </p>
              )
            ) : null}

            {canManage ? (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {active ? (
                  <>
                    <ConfirmDialog
                      action={qrAction}
                      hidden={{ op: "regenerate" }}
                      triggerLabel="QR'ı yenile"
                      title={`${table.name}: QR kodu yenilensin mi?`}
                      description="Yeni bir QR adresi üretilir ve mevcut QR kodu ANINDA çalışmaz hale gelir. Masadaki eski etiketi yenisiyle değiştirmeniz gerekir."
                      confirmLabel="QR'ı yenile"
                      destructive
                    />
                    <ConfirmDialog
                      action={qrAction}
                      hidden={{ op: "revoke" }}
                      triggerLabel="QR'ı iptal et"
                      triggerVariant="ghost"
                      title={`${table.name}: QR kodu iptal edilsin mi?`}
                      description="Bu masanın QR adresi kalıcı olarak çalışmaz hale gelir; iptal edilen kod yeniden etkinleştirilemez. Daha sonra yeni bir QR oluşturabilirsiniz."
                      confirmLabel="QR'ı iptal et"
                      destructive
                    />
                  </>
                ) : (
                  <QrActionButton action={qrAction} op="create" label="QR kodu oluştur" />
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {service ? (
        <section aria-labelledby="table-service" className="mt-6" data-testid="table-service-summary">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="table-service" className="text-base font-semibold">
              Servis talepleri
            </h2>
            <p className="text-sm text-fg-subtle">
              Ortalama yanıt (30 gün): <span className="font-medium text-fg tabular-nums">{formatDurationShort(service.avgResponseMs)}</span>
              {service.samples ? ` · ${service.samples} talep` : ""} ·{" "}
              <Link href="/panel/servis" className="underline underline-offset-2">
                Servis panosu
              </Link>
            </p>
          </div>
          {service.active.length || service.recent.length ? (
            <ul className="divide-y divide-border rounded-lg ring-1 ring-border">
              {[...service.active, ...service.recent].map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-medium">
                    {SERVICE_TYPE_LABELS[r.type]}
                    {r.note ? <span className="font-normal text-fg-subtle"> · “{r.note}”</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-fg-subtle">
                    <span className="tabular-nums">{formatDateTime(r.createdAt)}</span>
                    {r.acknowledgedByName ? <span>· {r.acknowledgedByName}</span> : null}
                    <Badge tone={SERVICE_STATUS_TONES[r.status]} dot>
                      {SERVICE_STATUS_LABELS[r.status]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-fg-subtle">Bu masadan henüz servis talebi gelmedi.</p>
          )}
        </section>
      ) : null}

      {table.qrTokens.length > 0 ? (
        <section aria-labelledby="qr-history" className="mt-6">
          <h2 id="qr-history" className="mb-3 text-base font-semibold">
            QR geçmişi
          </h2>
          <Table>
            <THead>
              <TR>
                <TH>Oluşturuldu</TH>
                <TH>Durum</TH>
                <TH>İptal</TH>
                <TH className="text-right">Okutma</TH>
              </TR>
            </THead>
            <TBody>
              {table.qrTokens.map((t) => (
                <TR key={t.id}>
                  <TD label="Oluşturuldu">{formatDateTime(t.createdAt)}</TD>
                  <TD label="Durum">{t.active ? <Badge tone="success">Etkin</Badge> : <Badge>İptal edildi</Badge>}</TD>
                  <TD label="İptal">{t.revokedAt ? formatDateTime(t.revokedAt) : "—"}</TD>
                  <TD label="Okutma" className="text-right tabular-nums">
                    {formatNumber(t.scanCount)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      ) : null}
    </>
  );
}

function ReadOnly({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 font-medium text-fg">{value}</dd>
    </div>
  );
}
