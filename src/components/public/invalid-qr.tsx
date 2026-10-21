import { QrCode } from "lucide-react";

/**
 * Geçersiz / iptal edilmiş / süresi dolmuş / pasif masaya ait / başka işletmenin QR kodu — TEK nötr görünüm.
 * İşletmenin, masanın var olup olmadığı ya da reddin nedeni hiçbir şekilde belli edilmez.
 */
export function InvalidQrView() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#faf8f5] px-6 text-center text-[#1c1917]">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
        <QrCode aria-hidden="true" className="size-7 text-[#78716c]" />
      </span>
      <h1 className="mt-5 text-[1.375rem] font-semibold tracking-tight text-balance">Bu QR kod artık geçerli değil.</h1>
      <p className="mt-2 max-w-xs text-[0.9375rem] leading-relaxed text-[#57534e]">Lütfen işletme personelinden güncel QR kodu isteyin.</p>
      <p lang="en" className="mt-6 max-w-xs text-xs text-[#78716c]">
        This QR code is no longer valid. Please ask the staff for an up-to-date code.
      </p>
    </main>
  );
}
