import { Receipt } from "lucide-react";

export const metadata = { title: "Sipariş bulunamadı", robots: { index: false, follow: false } };

/**
 * Sipariş bu masanın QR bağlamıyla eşleşmiyor / yok / 24 saati geçti / QR geçersiz — tek nötr görünüm
 * (siparişin, masanın ya da işletmenin var olup olmadığı belli edilmez).
 */
export default function OrderNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#faf8f5] px-6 text-center text-[#1c1917]">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
        <Receipt aria-hidden="true" className="size-7 text-[#78716c]" />
      </span>
      <h1 className="mt-5 text-[1.375rem] font-semibold tracking-tight">Sipariş görüntülenemiyor.</h1>
      <p className="mt-2 max-w-xs text-[0.9375rem] leading-relaxed text-[#57534e]">Siparişinizi görmek için masanızdaki QR kodu yeniden okutun ya da personelden yardım isteyin.</p>
      <p lang="en" className="mt-6 max-w-xs text-xs text-[#78716c]">
        This order can’t be shown. Please scan the QR code on your table again or ask the staff.
      </p>
    </main>
  );
}
