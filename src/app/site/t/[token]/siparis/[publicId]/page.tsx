import type { Metadata } from "next";
import { ArrowLeft, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { textDirection } from "@/config/menu";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/menu/money";
import { formatOrderNumber } from "@/lib/orders/status";
import { NUMBER_LOCALES, PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_PARAM, pickPublicLocale } from "@/lib/public-menu/i18n";
import { orderStrings } from "@/lib/public-menu/i18n-order";
import { promotionStrings } from "@/lib/promotions/i18n";
import { cn } from "@/lib/utils/cn";
import { publicOrderIdSchema } from "@/lib/validation/orders";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { getPublicOrder } from "@/server/repositories/orders.repository";
import { publicAccountFor } from "@/server/crm/public-account";
import { OrderLiveStatus } from "@/components/public/order-live-status";
import { LoyaltyInvite } from "@/components/public/crm/loyalty-invite";
import { paymentStrings } from "@/lib/payments/i18n";
import { findPublicOrderId } from "@/server/repositories/orders.repository";
import { loadOrderPaymentView, onlinePaymentsAvailable } from "@/server/payments/payment.service";
import { getTenantEntitlements } from "@/server/billing/entitlements";

/**
 * Müşteri sipariş durumu — /t/<token>/siparis/<publicId> (kiracı alan adı).
 *
 * Erişim kuralı: sipariş YALNIZCA aynı kiracının AYNI masasının geçerli QR bağlamından görülür (token + host) ve son
 * 24 saatle sınırlıdır. Public kimlik tek başına yetki değildir; başka masanın / başka kiracının QR'ıyla açılmaz,
 * eşleşmezse nötr 404. Görünüm yalnızca sipariş kopyalarını kullanır (canlı menüye bakılmaz).
 * Canlı: OrderLiveStatus durum değişikliğinde sayfayı sunucudan yeniden çeker (SSE + yedek periyodik yenileme).
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string; publicId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Sipariş", robots: { index: false, follow: false, nocache: true, noarchive: true }, referrer: "no-referrer" };

export default async function PublicOrderPage({ params, searchParams }: Props) {
  const { token, publicId } = await params;
  if (!publicOrderIdSchema.safeParse(publicId).success) notFound();
  const result = await getTableQrContext(token);
  if (!result.ok) notFound();
  const { context } = result;
  const order = await getPublicOrder({ tenantId: context.tenant.id, tableId: context.table.id }, publicId);
  if (!order) notFound();

  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: context.tenant.id }, select: { defaultLocale: true, timezone: true } });
  const query = (await searchParams)[PUBLIC_LOCALE_PARAM];
  const locale = pickPublicLocale({ query: typeof query === "string" ? query : null, cookie: (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value ?? null, tenantDefault: settings?.defaultLocale ?? "tr" });
  const o = orderStrings(locale);
  const p = promotionStrings(locale);
  const money = (minor: number) => formatMoney(minor, order.currency, NUMBER_LOCALES[locale]);
  const time = new Intl.DateTimeFormat(NUMBER_LOCALES[locale], { dateStyle: "medium", timeStyle: "short", timeZone: settings?.timezone ?? "Europe/Istanbul" }).format(order.createdAt);
  const rejected = order.status === "REJECTED" || order.status === "CANCELLED";
  const StatusIcon = rejected ? XCircle : order.status === "SUBMITTED" || order.status === "ACCEPTED" || order.status === "PREPARING" ? Clock : CheckCircle2;
  const ready = order.status === "READY";
  // İsteğe bağlı hesap: kimliksiz misafire sakin davet; kimlikli misafire yalnızca küçük puan bağlantısı.
  const account = await publicAccountFor(context.tenant.id, token);
  const crmOn = (await getTenantEntitlements(context.tenant.id)).has("crm");
  // Ödeme kartı: yalnızca online ödeme açık + sipariş ödenebilir durumda + kalan bakiye varsa "Ödeme Yap"; ödeme varsa özet.
  const pay = paymentStrings(locale);
  const orderId = await findPublicOrderId({ tenantId: context.tenant.id, tableId: context.table.id }, publicId);
  const [payView, payOnline] = orderId ? await Promise.all([loadOrderPaymentView(prisma, context.tenant.id, orderId), onlinePaymentsAvailable(context.tenant.id)]) : [null, false];

  return (
    <div dir={textDirection(locale)} lang={locale} className="min-h-dvh bg-[#faf8f5] text-stone-900">
      <main className="mx-auto max-w-xl px-4 pb-12 pt-6">
        <Link href={`/t/${token}`} className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-[0.9375rem] font-medium text-stone-700 hover:bg-stone-200/60">
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" /> {o.backToMenu}
        </Link>
        <header className="mt-4">
          <p className="text-[0.8125rem] font-medium uppercase tracking-[0.12em] text-stone-500">{context.tenant.name}</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold tracking-tight">
            {o.orderTitle} <span className="tabular-nums" data-testid="public-order-number">{formatOrderNumber(order.orderNumber)}</span>
          </h1>
          <p className="mt-1 text-stone-600">
            {order.tableName}
            {order.areaName ? ` · ${order.areaName}` : ""} · {order.branchName}
          </p>
        </header>

        <section aria-labelledby="status-heading" className={cn("mt-6 rounded-2xl p-5 ring-1", rejected ? "bg-red-50 ring-red-200" : order.status === "SUBMITTED" ? "bg-amber-50 ring-amber-200" : ready ? "bg-emerald-100 ring-2 ring-emerald-400" : "bg-emerald-50 ring-emerald-200")}>
          <h2 id="status-heading" className="sr-only">
            {o.statusHeading}
          </h2>
          <p aria-live="polite" className={cn("flex items-center gap-2.5 font-semibold", ready ? "text-[1.25rem]" : "text-[1.0625rem]")} data-testid="public-order-status" data-status={order.status}>
            <StatusIcon aria-hidden="true" className="size-5 shrink-0" /> {o.status[order.status]}
          </p>
          {o.statusHint[order.status] ? <p className="mt-1.5 text-sm text-stone-700">{o.statusHint[order.status]}</p> : null}
          {order.status === "REJECTED" && order.rejectionReason ? (
            <p className="mt-2 text-sm">
              <span className="font-semibold">{o.rejectionReason}:</span> {order.rejectionReason}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-stone-500">
            {o.orderedAt}: {time}
          </p>
          <OrderLiveStatus streamUrl={`/t/${token}/siparis/${order.publicId}/akis`} status={order.status} reconnectingLabel={o.liveReconnecting} />
        </section>

        {payView && (payView.summary.paid > 0 || (payOnline && payView.payable && payView.summary.remaining > 0)) ? (
          <section aria-label={pay.payTitle} className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-stone-200" data-testid="order-pay-card" data-state={payView.summary.state}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-stone-600">{payView.summary.remaining > 0 ? pay.remaining : pay.paid}</span>
              <span className="text-[1.25rem] font-semibold tabular-nums" data-testid="order-pay-remaining">
                {money(payView.summary.remaining > 0 ? payView.summary.remaining : payView.summary.paid)}
              </span>
            </div>
            {payView.summary.remaining <= 0 ? <p className="mt-1.5 text-sm text-emerald-800">{pay.fullyPaid}</p> : null}
            {payOnline && payView.payable && payView.summary.remaining > 0 ? (
              <Link href={`/t/${token}/siparis/${order.publicId}/odeme`} className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-emerald-700 font-semibold text-white" data-testid="order-pay-cta">
                {pay.payCta}
              </Link>
            ) : null}
          </section>
        ) : null}

        {account.identified || !crmOn ? null : <LoyaltyInvite href={`${account.href}?from=order`} locale={locale} loyalty={account.loyaltyEnabled} />}

        <section aria-label={o.items(order.itemCount)} className="mt-6 rounded-2xl bg-white px-5 ring-1 ring-stone-200">
          <ul className="divide-y divide-stone-200/80">
            {order.items.map((item, i) => (
              <li key={i} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words font-semibold">
                    <span className="tabular-nums text-stone-500">{item.quantity}× </span>
                    {item.productName}
                  </p>
                  <p className="shrink-0 font-semibold tabular-nums">{money(item.lineTotalMinor)}</p>
                </div>
                {item.variantName || item.modifiers.length ? (
                  <p className="mt-0.5 break-words text-sm text-stone-600">{[item.variantName, ...item.modifiers.map((m) => m.modifierName)].filter(Boolean).join(" · ")}</p>
                ) : null}
                {item.note ? <p className="mt-1 break-words text-sm italic text-stone-500">“{item.note}”</p> : null}
              </li>
            ))}
          </ul>
          {order.customerNote ? <p className="border-t border-stone-200/80 py-4 text-sm text-stone-600">“{order.customerNote}”</p> : null}
          {order.promotion ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-stone-200/80 pt-4 text-sm" data-testid="public-order-discount">
              <dt className="text-stone-500">{p.subtotal}</dt>
              <dd className="text-end tabular-nums">{money(order.subtotalMinor)}</dd>
              <dt className="min-w-0 break-words text-emerald-800">
                {p.discount} · {order.promotion.label}
                {order.promotion.freeItemName ? <span className="block text-xs">{p.freeItem(order.promotion.freeItemName)}</span> : null}
              </dt>
              <dd className="text-end tabular-nums text-emerald-800">−{money(order.discountMinor)}</dd>
            </dl>
          ) : null}
          <div className="flex items-baseline justify-between border-t border-stone-200/80 py-4">
            <span className="text-stone-600">{o.total}</span>
            <span className="text-[1.25rem] font-semibold tabular-nums" data-testid="public-order-total">
              {money(order.totalMinor)}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
