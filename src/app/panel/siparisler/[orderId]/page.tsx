import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/menu/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments/state";
import { prisma } from "@/lib/db/prisma";
import { recordManualPaymentAction } from "@/server/actions/payment.actions";
import { getPaymentSettings, loadOrderPaymentView } from "@/server/payments/payment.service";
import { listOrderPayments } from "@/server/repositories/payments.repository";
import { OrderPaymentBadge, PaymentStatusBadge } from "@/components/payments/payment-badges";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { hasPermission } from "@/lib/permissions/roles";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, TICKET_STATUS_LABELS, canStaffTransition, formatOrderNumber } from "@/lib/orders/status";
import { formatDateTime } from "@/lib/utils/format";
import { orderStatusAction } from "@/server/actions/order.actions";
import { listOrderTickets } from "@/server/repositories/kds.repository";
import { getOrderDetail } from "@/server/repositories/orders.repository";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = { title: "Sipariş" };

/**
 * Sipariş ayrıntısı — YALNIZCA gönderim anındaki kopyalar (ürün / varyant / ekstra adı ve fiyatları, masa / bölge).
 * Menü sonradan değişse / arşivlense de görünüm değişmez. Kabul / ret: orders.manage + yazma (destek modunda yok).
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await requireTenantUser({ permission: "orders.view" });
  const { orderId } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(orderId)) notFound();
  const detail = await getOrderDetail(ctx.scope, orderId);
  if (!detail) notFound();
  const { order, actorNames, customer } = detail;
  const canSeeCrm = hasPermission(ctx.user.role === "SUPER_ADMIN" ? "TENANT_OWNER" : ctx.user.role, "crm.view");
  const tickets = await listOrderTickets(ctx.scope, order.id);
  const staff = !ctx.support && ctx.user.role !== "SUPER_ADMIN";
  const canManage = staff && hasPermission(ctx.user.role, "orders.manage");
  const canServe = staff && hasPermission(ctx.user.role, "orders.serve") && canStaffTransition(order.status, "SERVED");
  const canCancel = staff && hasPermission(ctx.user.role, "orders.cancel") && canStaffTransition(order.status, "CANCELLED");
  const action = orderStatusAction.bind(null, order.id);
  const money = (minor: number) => formatMoney(minor, order.currency);
  // Ödeme: payments.view (sahip / müdür / kasiyer) tam kart; garson yalnızca durum rozeti. Mutfak / bar ödeme görmez.
  const roleForView = ctx.user.role === "SUPER_ADMIN" ? "TENANT_OWNER" : ctx.user.role;
  const canSeePayments = hasPermission(roleForView, "payments.view");
  const showPaymentBadge = canSeePayments || ctx.user.role === "WAITER";
  const [payView, payments, paySettings] = await Promise.all([showPaymentBadge ? loadOrderPaymentView(prisma, ctx.scope.tenantId, order.id) : Promise.resolve(null), canSeePayments ? listOrderPayments(ctx.scope, order.id) : Promise.resolve([]), getPaymentSettings(ctx.scope.tenantId)]);
  const canRecord = staff && hasPermission(ctx.user.role, "payments.manage") && paySettings.enabled && !!payView?.payable && (payView?.summary.available ?? 0) > 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/panel/siparisler" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft aria-hidden="true" /> Siparişler
        </Link>
        <h1 className="text-title font-semibold tabular-nums" data-testid="panel-order-number">
          {formatOrderNumber(order.orderNumber)}
        </h1>
        <Badge tone={ORDER_STATUS_TONES[order.status]} dot data-testid="panel-order-status">
          {ORDER_STATUS_LABELS[order.status]}
        </Badge>
        <LiveRefresh orderId={order.id} />
      </div>
      <p className="-mt-2 mb-6 text-sm text-fg-subtle">
        {order.branchName} · {order.tableName}
        {order.areaName ? ` · ${order.areaName}` : ""} · {formatDateTime(order.createdAt)} · QR masa siparişi
        {customer ? (
          <>
            {" · Müşteri: "}
            {canSeeCrm ? (
              <Link href={`/panel/musteriler/${customer.id}`} className="font-medium text-fg underline-offset-4 hover:underline" data-testid="order-customer">
                {customer.name}
              </Link>
            ) : (
              <span className="font-medium text-fg" data-testid="order-customer">
                {customer.name}
              </span>
            )}
          </>
        ) : null}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Ürünler</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {order.items.map((item, i) => (
                <li key={i} className="px-5 py-4" data-testid="panel-order-item">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-fg">
                        <span className="tabular-nums text-fg-subtle">{item.quantity}× </span>
                        {item.productNameDefault}
                        {item.productName !== item.productNameDefault ? <span className="text-fg-subtle"> ({item.productName})</span> : null}
                      </p>
                      <p className="mt-0.5 text-sm text-fg-subtle tabular-nums">
                        {item.variantName ? `${item.variantName} · ` : ""}
                        {money(item.basePriceMinor)}
                      </p>
                      {item.modifiers.length ? (
                        <ul className="mt-1 text-sm text-fg-muted">
                          {item.modifiers.map((m, j) => (
                            <li key={j}>
                              + {m.groupName}: {m.modifierName}
                              {m.priceDeltaMinor > 0 ? <span className="tabular-nums text-fg-subtle"> ({money(m.priceDeltaMinor)})</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {item.note ? <p className="mt-1.5 rounded-md bg-warning-soft px-2 py-1 text-sm text-warning">Not: {item.note}</p> : null}
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className="font-medium text-fg">{money(item.lineTotalMinor)}</p>
                      <p className="text-xs text-fg-subtle">birim {money(item.unitPriceMinor)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {order.customerNote ? (
              <p className="border-t border-border px-5 py-4 text-sm">
                <span className="font-medium">Sipariş notu:</span> {order.customerNote}
              </p>
            ) : null}
            <dl className="border-t border-border px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-subtle">Ara toplam</dt>
                <dd className="tabular-nums">{money(order.subtotalMinor)}</dd>
              </div>
              {order.promotion ? (
                <div className="mt-1 flex justify-between gap-3 text-success" data-testid="panel-order-discount">
                  <dt className="min-w-0">
                    İndirim · {order.promotion.kind === "COUPON" ? `Kupon ${order.promotion.codeSnapshot ?? ""}` : `Sadakat ödülü (${order.promotion.pointsSpent ?? 0} puan)`} — {order.promotion.label}
                    {order.promotion.freeItemName ? <span className="block text-xs">1× {order.promotion.freeItemName} ücretsiz</span> : null}
                  </dt>
                  <dd className="shrink-0 tabular-nums">−{money(order.discountMinor)}</dd>
                </div>
              ) : null}
              <div className="mt-1 flex justify-between text-base font-semibold">
                <dt>Toplam</dt>
                <dd className="tabular-nums" data-testid="panel-order-total">
                  {money(order.totalMinor)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          {canManage && order.status === "SUBMITTED" ? (
            <Card>
              <CardHeader>
                <CardTitle>Karar</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {canStaffTransition(order.status, "ACCEPTED") ? (
                  <ConfirmDialog
                    action={action}
                    hidden={{ to: "ACCEPTED" }}
                    triggerLabel="Kabul et"
                    triggerVariant="primary"
                    title={`${formatOrderNumber(order.orderNumber)} kabul edilsin mi?`}
                    description="Ürünler hazırlama istasyonlarına fiş olarak gönderilir; müşteri sipariş sayfasında “Kabul edildi” görür."
                    confirmLabel="Kabul et"
                  />
                ) : null}
                {canStaffTransition(order.status, "REJECTED") ? (
                  <ConfirmDialog
                    action={action}
                    hidden={{ to: "REJECTED" }}
                    triggerLabel="Reddet"
                    title={`${formatOrderNumber(order.orderNumber)} reddedilsin mi?`}
                    description="Sipariş reddedilir ve geri alınamaz. Açıklama müşteriye gösterilir."
                    confirmLabel="Reddet"
                    destructive
                  >
                    <Field id="reject-reason" label="Açıklama (isteğe bağlı, müşteri görür)">
                      <Textarea id="reject-reason" name="reason" rows={2} maxLength={200} />
                    </Field>
                  </ConfirmDialog>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {canServe || canCancel ? (
            <Card>
              <CardHeader>
                <CardTitle>İşlem</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {canServe ? (
                  <ConfirmDialog
                    action={action}
                    hidden={{ to: "SERVED" }}
                    triggerLabel="Servis edildi"
                    triggerVariant="primary"
                    title={`${formatOrderNumber(order.orderNumber)} servis edildi mi?`}
                    description="Sipariş tamamlanır ve mutfak ekranından kalkar."
                    confirmLabel="Servis edildi"
                  />
                ) : null}
                {canCancel ? (
                  <ConfirmDialog
                    action={action}
                    hidden={{ to: "CANCELLED" }}
                    triggerLabel="İptal et"
                    title={`${formatOrderNumber(order.orderNumber)} iptal edilsin mi?`}
                    description="Açık istasyon fişleri de iptal edilir. Bu işlem geri alınamaz. Alınmış ödemeler otomatik iade edilmez; gerekirse Ödemeler bölümünden iade edin."
                    confirmLabel="İptal et"
                    destructive
                  >
                    <Field id="cancel-reason" label="İptal nedeni (zorunlu)">
                      <Textarea id="cancel-reason" name="reason" rows={2} minLength={3} maxLength={200} required />
                    </Field>
                  </ConfirmDialog>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {payView ? (
            <Card data-testid="order-payment-card">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  Ödeme <OrderPaymentBadge state={payView.summary.state} />
                </CardTitle>
              </CardHeader>
              {canSeePayments ? (
                <CardContent className="grid gap-4">
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-fg-subtle">Toplam</dt>
                    <dd className="text-right tabular-nums">{money(order.totalMinor)}</dd>
                    <dt className="text-fg-subtle">Ödenen</dt>
                    <dd className="text-right tabular-nums" data-testid="order-paid">
                      {money(payView.summary.paid)}
                    </dd>
                    {payView.summary.refunded > 0 ? (
                      <>
                        <dt className="text-fg-subtle">İade edilen</dt>
                        <dd className="text-right tabular-nums">{money(payView.summary.refunded)}</dd>
                      </>
                    ) : null}
                    {payView.summary.reserved > 0 ? (
                      <>
                        <dt className="text-warning">Süren online ödeme</dt>
                        <dd className="text-right tabular-nums text-warning">{money(payView.summary.reserved)}</dd>
                      </>
                    ) : null}
                    <dt className="font-semibold">Kalan</dt>
                    <dd className="text-right font-semibold tabular-nums" data-testid="order-remaining" data-minor={payView.summary.remaining}>
                      {money(payView.summary.remaining)}
                    </dd>
                  </dl>
                  {payments.length ? (
                    <ul className="grid gap-2 border-t border-border pt-3 text-sm">
                      {payments.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2" data-testid="order-payment-row" data-status={p.status}>
                          <Link href={`/panel/odemeler/${p.id}`} className="min-w-0 underline-offset-4 hover:underline">
                            {PAYMENT_METHOD_LABELS[p.method]} · <span className="tabular-nums">{money(p.amountMinor)}</span>
                            {p.cardLast4 ? <span className="text-fg-subtle">{` · •••• ${p.cardLast4}`}</span> : null}
                            {p._count.attempts > 1 ? <span className="text-fg-subtle">{` · ${p._count.attempts} deneme`}</span> : null}
                          </Link>
                          <PaymentStatusBadge status={p.status} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {canRecord ? (
                    <ConfirmDialog
                      action={recordManualPaymentAction.bind(null, order.id)}
                      hidden={{ key: randomBytes(18).toString("base64url") }}
                      triggerLabel="Kasada ödeme kaydet"
                      triggerVariant="primary"
                      title="Kasada alınan ödeme"
                      description={`Kalan ${money(payView.summary.available)}. Tutarı boş bırakırsanız kalanın tamamı kaydedilir.`}
                      confirmLabel="Ödemeyi kaydet"
                    >
                      <Field id="manual-method" label="Yöntem">
                        <Select id="manual-method" name="method" defaultValue="CASH">
                          {paySettings.allowCash ? <option value="CASH">Nakit</option> : null}
                          {paySettings.allowCardTerminal ? <option value="CARD_TERMINAL">Kart (POS cihazı)</option> : null}
                          <option value="OTHER">Diğer</option>
                        </Select>
                      </Field>
                      <Field id="manual-amount" label="Tutar (boş = kalanın tamamı)">
                        <Input id="manual-amount" name="amount" inputMode="decimal" placeholder="ör. 250 ya da 12,50" />
                      </Field>
                    </ConfirmDialog>
                  ) : null}
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          {tickets.length ? (
            <Card>
              <CardHeader>
                <CardTitle>İstasyon fişleri</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {tickets.map((t) => (
                  <div key={t.id} className="rounded-lg p-3 ring-1 ring-border" data-testid="panel-order-ticket" data-ticket-status={t.status}>
                    <p className="flex items-center justify-between gap-2 font-medium">
                      {t.stationName}
                      <Badge tone={t.status === "READY" ? "success" : t.status === "PREPARING" ? "info" : t.status === "CANCELLED" ? "neutral" : "warning"} dot>
                        {TICKET_STATUS_LABELS[t.status]}
                      </Badge>
                    </p>
                    <ul className="mt-1 text-sm text-fg-muted">
                      {t.items.map(({ orderItem: i }) => (
                        <li key={i.id}>
                          {i.quantity}× {i.productNameDefault}
                          {i.variantName ? ` — ${i.variantName}` : ""}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-xs text-fg-subtle">
                      {t.startedAt ? `Başladı ${formatDateTime(t.startedAt)}` : `Oluştu ${formatDateTime(t.createdAt)}`}
                      {t.readyAt ? ` · Hazır ${formatDateTime(t.readyAt)}` : ""}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Durum geçmişi</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-3 text-sm">
                {order.history.map((h) => (
                  <li key={h.id} data-testid="panel-order-history" data-status={h.toStatus}>
                    <p className="font-medium">{ORDER_STATUS_LABELS[h.toStatus]}</p>
                    <p className="text-fg-subtle">
                      {formatDateTime(h.createdAt)} · {h.actorType === "CUSTOMER" ? "Müşteri (QR)" : h.actorUserId ? (actorNames.get(h.actorUserId) ?? "Personel") : "Sistem (mutfak fişleri)"}
                    </p>
                    {h.reason ? <p className="mt-0.5 text-fg-muted">“{h.reason}”</p> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
