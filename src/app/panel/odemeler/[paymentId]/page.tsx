import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { formatMoney, minorToInput } from "@/lib/menu/money";
import { formatOrderNumber } from "@/lib/orders/status";
import { PAYMENT_METHOD_LABELS, refundableMinor } from "@/lib/payments/state";
import { hasPermission } from "@/lib/permissions/roles";
import { formatDateTime } from "@/lib/utils/format";
import { reconcilePaymentAction, refundPaymentAction } from "@/server/actions/payment.actions";
import { getPaymentDetail, maskReference } from "@/server/repositories/payments.repository";
import { PaymentStatusBadge } from "@/components/payments/payment-badges";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = { title: "Ödeme" };

const SPLIT_LABELS = { FULL: "Tamamı", AMOUNT: "Tutar ile", EQUAL: "Eşit bölüşüm", ITEMS: "Ürün seçimi" } as const;
const ATTEMPT_LABELS = { CREATED: "Oluşturuldu", PROCESSING: "İşleniyor", SUCCEEDED: "Başarılı", FAILED: "Başarısız", EXPIRED: "Süresi doldu", CANCELLED: "İptal" } as const;
const REFUND_LABELS = { PENDING: "Bekliyor", SUCCEEDED: "Tamamlandı", FAILED: "Başarısız" } as const;

/**
 * Ödeme ayrıntısı: denemeler, dağılım (kalem / tutar), iadeler. Kart numarası / CVV hiç SAKLANMAZ; yalnızca marka +
 * son 4 hane. Sağlayıcı referansı kısaltılmış. İade: payments.refund (sahip / müdür / kasiyer); mutabakat: sahip / müdür.
 */
export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const ctx = await requireTenantUser({ permission: "payments.view" });
  const { paymentId } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(paymentId)) notFound();
  const p = await getPaymentDetail(ctx.scope, paymentId);
  if (!p) notFound();
  const money = (minor: number) => formatMoney(minor, p.currency);
  const staff = !ctx.support && ctx.user.role !== "SUPER_ADMIN";
  const pendingRefunds = p.refunds.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.amountMinor, 0);
  const refundable = refundableMinor(p) - pendingRefunds;
  const canRefund = staff && hasPermission(ctx.user.role, "payments.refund") && refundable > 0;
  const canReconcile = staff && (ctx.user.role === "TENANT_OWNER" || ctx.user.role === "BRANCH_MANAGER");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/panel/odemeler" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft aria-hidden="true" /> Ödemeler
        </Link>
        <h1 className="text-title font-semibold tabular-nums" data-testid="payment-amount">
          {money(p.amountMinor)}
        </h1>
        <PaymentStatusBadge status={p.status} />
        {p.provider === "mock" ? <Badge tone="warning">Test sağlayıcısı</Badge> : null}
        {p.needsRefund ? (
          <Badge tone="danger" data-testid="payment-needs-refund">
            İade gerekli
          </Badge>
        ) : null}
      </div>
      <p className="-mt-2 mb-6 text-sm text-fg-subtle">
        <Link href={`/panel/siparisler/${p.order.id}`} className="font-medium text-fg underline-offset-4 hover:underline">
          {formatOrderNumber(p.order.orderNumber)}
        </Link>{" "}
        · {p.order.tableName} · {p.branch.name} · {formatDateTime(p.createdAt)}
      </p>

      {p.needsRefund ? (
        <p role="note" className="mb-6 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-fg">
          Bu online ödeme, bakiye başka bir ödemeyle kapandıktan SONRA sağlayıcıda onaylandı. Sipariş fazla ödenmesin diye bakiyeye sayılmadı; müşteriye iade edilmelidir (sağlayıcı panelinden).
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Özet</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-fg-subtle">Yöntem</dt>
                <dd>{PAYMENT_METHOD_LABELS[p.method]}</dd>
                <dt className="text-fg-subtle">Bölme</dt>
                <dd>{SPLIT_LABELS[p.splitMode]}</dd>
                {p.cardLast4 ? (
                  <>
                    <dt className="text-fg-subtle">Kart</dt>
                    <dd data-testid="payment-card">{`${p.cardBrand ?? "Kart"} •••• ${p.cardLast4}`}</dd>
                  </>
                ) : null}
                <dt className="text-fg-subtle">İade edilen</dt>
                <dd className="tabular-nums" data-testid="payment-refunded">
                  {money(p.refundedMinor)}
                </dd>
                <dt className="text-fg-subtle">İade edilebilir</dt>
                <dd className="tabular-nums">{money(Math.max(0, refundable))}</dd>
                {p.failureCode ? (
                  <>
                    <dt className="text-fg-subtle">Hata kodu</dt>
                    <dd className="font-mono text-xs">{p.failureCode}</dd>
                  </>
                ) : null}
                {p.succeededAt ? (
                  <>
                    <dt className="text-fg-subtle">Onaylandı</dt>
                    <dd>{formatDateTime(p.succeededAt)}</dd>
                  </>
                ) : null}
                {p.createdByUserId ? (
                  <>
                    <dt className="text-fg-subtle">Kaydeden</dt>
                    <dd>{p.userNames.get(p.createdByUserId) ?? "Personel"}</dd>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dağılım</CardTitle>
              <CardDescription>Ödemenin siparişe nasıl yazıldığı (kalem seçimi ya da tutar).</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1.5 text-sm">
                {p.allocations.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3" data-testid="payment-allocation">
                    <span>{a.orderItem ? `${a.quantity ?? 0}× ${a.orderItem.productNameDefault}${a.orderItem.variantName ? ` (${a.orderItem.variantName})` : ""}` : "Sipariş bakiyesine"}</span>
                    <span className="tabular-nums">{money(a.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {p.attempts.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Sağlayıcı denemeleri</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-3 text-sm">
                  {p.attempts.map((a) => (
                    <li key={a.id} data-testid="payment-attempt" data-status={a.status}>
                      <p className="font-medium">
                        {ATTEMPT_LABELS[a.status]} · <span className="tabular-nums">{money(a.amountMinor)}</span>
                      </p>
                      <p className="text-fg-subtle">
                        {a.provider} · ref <span className="font-mono text-xs">{maskReference(a.providerReference)}</span> · {formatDateTime(a.createdAt)}
                        {a.failureCode ? ` · ${a.failureCode}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          {canRefund ? (
            <Card>
              <CardHeader>
                <CardTitle>İade</CardTitle>
                <CardDescription>İade bakiyeyi yeniden açmaz ve sadakat puanı / kuponu değiştirmez.</CardDescription>
              </CardHeader>
              <CardContent>
                <ConfirmDialog
                  action={refundPaymentAction.bind(null, p.id)}
                  hidden={{ key: randomBytes(18).toString("base64url") }}
                  triggerLabel="İade et"
                  title="İade yapılsın mı?"
                  description={p.method === "ONLINE" ? "İade ödeme sağlayıcısında başlatılır. Bu işlem geri alınamaz." : "Kasadan yapılan geri ödeme kaydedilir. Bu işlem geri alınamaz."}
                  confirmLabel="İade et"
                  destructive
                >
                  <Field id="refund-amount" label={`Tutar (en fazla ${money(refundable)})`}>
                    <Input id="refund-amount" name="amount" inputMode="decimal" defaultValue={minorToInput(refundable)} required />
                  </Field>
                  <Field id="refund-reason" label="Gerekçe (isteğe bağlı)">
                    <Textarea id="refund-reason" name="reason" rows={2} maxLength={200} />
                  </Field>
                </ConfirmDialog>
              </CardContent>
            </Card>
          ) : null}

          {canReconcile && p.method === "ONLINE" ? (
            <Card>
              <CardHeader>
                <CardTitle>Mutabakat</CardTitle>
                <CardDescription>Yerel durumu sağlayıcıdaki durumla karşılaştırır; webhook kaybolduysa günceller.</CardDescription>
              </CardHeader>
              <CardContent>
                <ConfirmDialog action={reconcilePaymentAction.bind(null, p.id)} triggerLabel="Sağlayıcıyla karşılaştır" title="Mutabakat yapılsın mı?" description="Sağlayıcıya durum sorulur. Kesinleşmiş ödeme geri alınmaz." confirmLabel="Karşılaştır" />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>İadeler</CardTitle>
            </CardHeader>
            <CardContent>
              {p.refunds.length ? (
                <ol className="grid gap-3 text-sm">
                  {p.refunds.map((r) => (
                    <li key={r.id} data-testid="payment-refund" data-status={r.status}>
                      <p className="font-medium">
                        <span className="tabular-nums">{money(r.amountMinor)}</span> · {REFUND_LABELS[r.status]}
                      </p>
                      <p className="text-fg-subtle">
                        {formatDateTime(r.createdAt)}
                        {r.createdByUserId ? ` · ${p.userNames.get(r.createdByUserId) ?? "Personel"}` : ""}
                        {r.providerReference ? ` · ref ${maskReference(r.providerReference)}` : ""}
                      </p>
                      {r.reason ? <p className="mt-0.5 text-fg-muted">“{r.reason}”</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-fg-subtle">İade yok.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
