import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPaymentProvider } from "@/server/payments/providers";
import { createMockProvider } from "@/server/payments/providers/mock";
import { processWebhook } from "@/server/payments/payment.service";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/menu/money";

/**
 * TEST sağlayıcısının barındırılan ödeme sayfası (gerçek para YOK; yalnızca PAYMENT_PROVIDER=mock). Gerçek
 * sağlayıcıda bu sayfa sağlayıcının kendi alan adındadır. Seçim, imzalı webhook olarak GERÇEK webhook işleyicisinden
 * geçer; ardından müşteri sipariş sayfasına döner (dönüş yalnızca /t/… yoluna; açık yönlendirme yok).
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Test ödemesi", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ r?: string }> };

const safeReturn = (r: string | undefined) => (r && /^\/t\/[A-Za-z0-9_-]+\/siparis\/[A-Za-z0-9_-]{22}\/odeme$/.test(r) ? r : "/");

export default async function MockCheckoutPage({ params, searchParams }: Props) {
  const provider = getPaymentProvider();
  const { ref } = await params;
  if (provider?.name !== "mock" || !/^mock_[0-9a-f]{24}$/.test(ref)) notFound();
  const attempt = await prisma.paymentAttempt.findUnique({ where: { provider_providerReference: { provider: "mock", providerReference: ref } }, select: { amountMinor: true, payment: { select: { currency: true, publicId: true } } } });
  if (!attempt) notFound();
  const back = safeReturn((await searchParams).r);

  async function complete(formData: FormData) {
    "use server";
    const outcome = formData.get("outcome");
    if (outcome === "succeeded" || outcome === "failed") {
      const { webhookSecret } = await import("@/server/payments/providers");
      const event = createMockProvider(webhookSecret()).buildEvent(ref, outcome === "succeeded" ? "payment.succeeded" : "payment.failed");
      await processWebhook("mock", event.rawBody, new Headers({ "x-masanova-signature": event.signature }));
    }
    redirect(`${back}?p=${attempt!.payment.publicId}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4">
      <form action={complete} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200" data-testid="mock-checkout">
        <p className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">TEST ÖDEME SAĞLAYICISI — gerçek para çekilmez</p>
        <h1 className="mt-4 text-xl font-semibold">Ödeme</h1>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(attempt.amountMinor, attempt.payment.currency)}</p>
        <p className="mt-2 text-sm text-stone-500">Kart bilgisi istenmez ve saklanmaz.</p>
        <div className="mt-6 grid gap-2">
          <button name="outcome" value="succeeded" className="min-h-12 rounded-xl bg-emerald-700 font-semibold text-white" data-testid="mock-succeed">
            Ödemeyi onayla (test)
          </button>
          <button name="outcome" value="failed" className="min-h-12 rounded-xl bg-white font-semibold text-red-700 ring-1 ring-red-200" data-testid="mock-fail">
            Reddet (test)
          </button>
          <button name="outcome" value="pending" className="min-h-12 rounded-xl font-medium text-stone-600" data-testid="mock-pending">
            Beklemede bırak
          </button>
        </div>
      </form>
    </main>
  );
}
