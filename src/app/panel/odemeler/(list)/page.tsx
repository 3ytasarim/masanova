import type { Metadata } from "next";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { CreditCard } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/menu/money";
import { formatOrderNumber } from "@/lib/orders/status";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/payments/state";
import { formatDateTime } from "@/lib/utils/format";
import { dateParam, enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { listOrderFilterOptions } from "@/server/repositories/orders.repository";
import { listPaymentsPage } from "@/server/repositories/payments.repository";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { PaymentStatusBadge } from "@/components/payments/payment-badges";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Ödemeler" };

const PAGE_SIZE = 25;
const STATUSES = Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[];
const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];
const SPLIT_LABELS = { FULL: "Tamamı", AMOUNT: "Tutar", EQUAL: "Eşit bölüşüm", ITEMS: "Ürün seçimi" } as const;
const inputClass =
  "h-11 w-full min-w-0 rounded-md border border-border-strong bg-bg px-3 text-sm focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10";

/** Ödeme listesi — online + kasada (nakit / POS / diğer). Kart verisi yalnızca marka + son 4 hane. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { scope } = await requireTenantUser({ permission: "payments.view" });
  const params = await searchParams;
  const [branches] = await listOrderFilterOptions(scope);
  const sube = param(params, "sube", 40);
  const branchId = branches.some((b) => b.id === sube) ? sube : undefined;
  const status = enumParam(params, "durum", STATUSES);
  const method = enumParam(params, "yontem", METHODS);
  const qRaw = param(params, "q", 10)?.replace(/^#/, "");
  const orderNumber = qRaw && /^\d{1,7}$/.test(qRaw) ? Number(qRaw) : undefined;
  const from = dateParam(params, "baslangic");
  const to = dateParam(params, "bitis", true);
  const page = pageParam(params);
  const { items, total } = await listPaymentsPage(scope, { status, method, branchId, from, to, orderNumber, page, pageSize: PAGE_SIZE });
  const hasFilters = !!(branchId || status || method || qRaw || from || to);

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Ödemeler</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Müşterinin QR üzerinden yaptığı online ödemeler ve kasada kaydedilen ödemeler. Online ödeme yalnızca sağlayıcı onayıyla “Başarılı” olur.</p>
      </header>

      <FilterBar action="/panel/odemeler" query={qRaw} searchPlaceholder="Sipariş no (ör. 1042)" searchLabel="Sipariş numarası ara" hasFilters={hasFilters}>
        {branches.length > 1 ? <FilterSelect id="p-sube" name="sube" label="Şube" value={branchId} options={[{ value: "", label: "Tümü" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} /> : null}
        <FilterSelect id="p-durum" name="durum" label="Durum" value={status} options={[{ value: "", label: "Tümü" }, ...STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] }))]} />
        <FilterSelect id="p-yontem" name="yontem" label="Yöntem" value={method} options={[{ value: "", label: "Tümü" }, ...METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))]} />
        <div className="grid min-w-0 gap-1">
          <label htmlFor="p-from" className="text-xs font-medium text-fg-subtle">
            Başlangıç
          </label>
          <input id="p-from" name="baslangic" type="date" defaultValue={param(params, "baslangic", 10)} className={inputClass} />
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor="p-to" className="text-xs font-medium text-fg-subtle">
            Bitiş
          </label>
          <input id="p-to" name="bitis" type="date" defaultValue={param(params, "bitis", 10)} className={inputClass} />
        </div>
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState icon={CreditCard} title={hasFilters ? "Sonuç yok" : "Henüz ödeme yok"} description={hasFilters ? "Filtreleri değiştirin." : "Müşteriler QR üzerinden ödediğinde ya da kasada ödeme kaydettiğinizde burada görünür."} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Ödeme</TH>
                <TH>Sipariş</TH>
                <TH>Yöntem</TH>
                <TH className="text-right">Tutar</TH>
                <TH>Durum</TH>
                <TH>Zaman</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((p) => (
                <TR key={p.id} data-testid="payment-row" data-status={p.status} data-method={p.method}>
                  <TD label="Ödeme">
                    <Link href={`/panel/odemeler/${p.id}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                      {SPLIT_LABELS[p.splitMode]}
                    </Link>
                    {p.needsRefund ? (
                      <Badge tone="danger" className="ml-2">
                        İade gerekli
                      </Badge>
                    ) : null}
                    {branches.length > 1 ? <span className="block text-xs text-fg-subtle">{p.branch.name}</span> : null}
                  </TD>
                  <TD label="Sipariş">
                    <Link href={`/panel/siparisler/${p.order.id}`} className="tabular-nums underline-offset-4 hover:underline">
                      {formatOrderNumber(p.order.orderNumber)}
                    </Link>
                    <span className="block text-xs text-fg-subtle">{p.order.tableName}</span>
                  </TD>
                  <TD label="Yöntem">
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.cardLast4 ? <span className="block text-xs text-fg-subtle">{`${p.cardBrand ?? "Kart"} •••• ${p.cardLast4}`}</span> : null}
                  </TD>
                  <TD label="Tutar" className="text-right tabular-nums font-medium text-fg">
                    {formatMoney(p.amountMinor, p.currency)}
                    {p.refundedMinor > 0 ? <span className="block text-xs text-fg-subtle">iade {formatMoney(p.refundedMinor, p.currency)}</span> : null}
                  </TD>
                  <TD label="Durum">
                    <PaymentStatusBadge status={p.status} />
                  </TD>
                  <TD label="Zaman" className="whitespace-nowrap">
                    {formatDateTime(p.createdAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination basePath="/panel/odemeler" query={{ sube: branchId, durum: status, yontem: method, q: qRaw, baslangic: param(params, "baslangic", 10), bitis: param(params, "bitis", 10) }} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}
