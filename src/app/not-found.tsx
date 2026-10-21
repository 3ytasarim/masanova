import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sayfa bulunamadı",
  robots: { index: false, follow: false },
};

/**
 * Statik 404. Göreli "/" bağlantısı bilinçli: platform alan adında pazarlama sitesine,
 * kiracı alan adında işletmenin kendi ana sayfasına döner.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-20 text-center">
      <p className="font-mono text-sm text-fg-subtle">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Aradığınız sayfa bulunamadı</h1>
      <p className="mt-2 max-w-sm text-sm text-fg-subtle">Adres yanlış yazılmış ya da sayfa kaldırılmış olabilir.</p>
      <Link href="/" className={buttonVariants({ variant: "secondary", className: "mt-6" })}>
        Ana sayfaya dön
      </Link>
    </main>
  );
}
