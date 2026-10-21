import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { textDirection } from "@/config/menu";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/menu/money";
import { formatOrderNumber } from "@/lib/orders/status";
import { paymentStrings } from "@/lib/payments/i18n";
import { NUMBER_LOCALES, PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_PARAM, pickPublicLocale } from "@/lib/public-menu/i18n";
import { publicOrderIdSchema } from "@/lib/validation/orders";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { findPublicOrderId } from "@/server/repositories/orders.repository";
import { loadOrderPaymentView, onlinePaymentsAvailable } from "@/server/payments/payment.service";
import { getPaymentProvider } from "@/server/payments/providers";
import { PayPanel } from "@/components/public/payment/pay-panel";

/**
 * Müşteri ödeme sayfası — /t/<token>/siparis/<publicId>/odeme (kiracı alan adı). Erişim, sipariş sayfasıyla AYNI
 * kural: aynı masanın geçerli QR bağlamı + son 24 saat. Barındırılan ödeme sayfasından dönüş de buraya gelir
 * (?p=<ödeme>) ve "Ödeme doğrulanıyor…" gösterilir; başarı yalnızca webhook / sağlayıcı sorgusuyla kesinleşir.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ödeme", robots: { index: false, follow: false, nocache: true, noarchive: true }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string; publicId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PublicPaymentPage({ params, searchParams }: Props) {
  const { token, publicId } = await params;
  if (!publicOrderIdSchema.safeParse(publicId).success) notFound();
  const result = await getTableQrContext(token);
  if (!result.ok) notFound();
  const tenantId = result.context.tenant.id;
  const orderId = await findPublicOrderId({ tenantId, tableId: result.context.table.id }, publicId);
  if (!orderId) notFound();
  const [view, available, settings] = await Promise.all([
    loadOrderPaymentView(prisma, tenantId, orderId),
    onlinePaymentsAvailable(tenantId),
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultLocale: true } }),
  ]);
  if (!view) notFound();

  const sp = await searchParams;
  const query = sp[PUBLIC_LOCALE_PARAM];
  const locale = pickPublicLocale({ query: typeof query === "string" ? query : null, cookie: (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value ?? null, tenantDefault: settings?.defaultLocale ?? "tr" });
  const s = paymentStrings(locale);
  const numberLocale = NUMBER_LOCALES[locale];
  const money = (minor: number) => formatMoney(minor, view.order.currency, numberLocale);
  const verify = typeof sp.p === "string" && /^[A-Za-z0-9_-]{22}$/.test(sp.p) ? sp.p : null;
  const { summary } = view;
  const isTest = getPaymentProvider()?.test === true;

  let body: React.ReactNode;
  if (verify) body = null;
  else if (summary.remaining <= 0) body = <Notice testId="pay-fully-paid">{s.fullyPaid}</Notice>;
  else if (!available) body = <Notice testId="pay-unavailable">{s.unavailable}</Notice>;
  else if (!view.payable) body = <Notice testId="pay-not-payable">{view.order.status === "SUBMITTED" ? s.notPayableYet : s.notPayable}</Notice>;

  return (
    <div dir={textDirection(locale)} lang={locale} className="min-h-dvh bg-[#faf8f5] text-stone-900">
      <main className="mx-auto max-w-xl px-4 pb-12 pt-6">
        <Link href={`/t/${token}/siparis/${publicId}`} className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-[0.9375rem] font-medium text-stone-700 hover:bg-stone-200/60">
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" /> {s.back}
        </Link>
        <header className="mt-4">
          <p className="text-[0.8125rem] font-medium uppercase tracking-[0.12em] text-stone-500">{result.context.tenant.name}</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold tracking-tight">
            {s.payTitle} · <span className="tabular-nums">{formatOrderNumber(view.order.orderNumber)}</span>
          </h1>
        </header>
        {isTest ? <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">{s.testProvider}</p> : null}

        <dl className="mt-5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-2xl bg-white p-5 ring-1 ring-stone-200" data-testid="pay-summary">
          <dt className="text-stone-600">{s.total}</dt>
          <dd className="text-end tabular-nums">{money(view.order.totalMinor)}</dd>
          <dt className="text-stone-600">{s.paid}</dt>
          <dd className="text-end tabular-nums" data-testid="pay-paid">
            {money(summary.paid)}
          </dd>
          {summary.reserved > 0 ? (
            <>
              <dt className="text-amber-800">{s.reserved}</dt>
              <dd className="text-end tabular-nums text-amber-800">{money(summary.reserved)}</dd>
            </>
          ) : null}
          <dt className="font-semibold">{s.remaining}</dt>
          <dd className="text-end text-[1.25rem] font-semibold tabular-nums" data-testid="pay-remaining" data-minor={summary.remaining}>
            {money(summary.remaining)}
          </dd>
        </dl>

        <div className="mt-5">
          {body ?? (
            <PayPanel
              token={token}
              orderPublicId={publicId}
              currency={view.order.currency}
              numberLocale={numberLocale}
              locale={locale}
              summary={summary}
              lines={view.lines.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, remainingUnits: l.remainingUnits, nextUnitsAmounts: l.nextUnitsAmounts }))}
              verifyPaymentId={verify}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Notice({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <p className="rounded-2xl bg-white p-5 text-stone-700 ring-1 ring-stone-200" data-testid={testId}>
      {children}
    </p>
  );
}
