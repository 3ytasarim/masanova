import type { Metadata } from "next";
import { ArrowRight, ChefHat, Mic, QrCode } from "lucide-react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "@/server/actions/auth.actions";
import { BrandLogo } from "@/components/layout/logo";
import { LoginScene } from "@/components/auth/login-scene";
import { FloatingIcons } from "@/components/brand/floating-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Giriş",
  robots: { index: false, follow: false },
};

const STATUS_MESSAGES: Record<string, string> = {
  "isletme-pasif": "İşletme hesabınız şu anda aktif değil. Lütfen MasaNova destek ekibiyle iletişime geçin.",
};

const HIGHLIGHTS = [
  { icon: QrCode, label: "QR menü" },
  { icon: Mic, label: "Sesli garson" },
  { icon: ChefHat, label: "Mutfak ekranı" },
];

/**
 * Giriş: masaüstünde solda hareketli restoran sahnesi + sağda açık cam kart; mobilde sahne arka plan, kart önde.
 * Form alanları ve davranış değişmedi (aynı loginAction, #email / #password).
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ durum?: string | string[] }> }) {
  const { durum } = await searchParams;
  const statusMessage = typeof durum === "string" ? STATUS_MESSAGES[durum] : undefined;
  const user = await getCurrentUser();

  return (
    <main className="relative grid min-h-dvh bg-[#faf7f4] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Sahne: mobilde tam arka plan, masaüstünde sol panel */}
      <LoginScene compact className="absolute inset-0 lg:hidden" />
      <section className="relative hidden lg:block" aria-label="MasaNova AI">
        <LoginScene className="absolute inset-0" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          <Link href="/" className="w-fit rounded-md" aria-label="MasaNova AI ana sayfa">
            <BrandLogo variant="dark" className="h-9" priority />
          </Link>
          <div className="max-w-md">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-300">Restoranınız tek ekranda</p>
            <h2 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight text-white xl:text-5xl">
              Masadan mutfağa,
              <br />
              <span className="bg-[linear-gradient(90deg,#fdba74,#f87171)] bg-clip-text text-transparent">sesle ve anında.</span>
            </h2>
            <ul className="mt-6 flex flex-wrap gap-2">
              {HIGHLIGHTS.map(({ icon: Icon, label }) => (
                <li key={label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-sm text-white/85 backdrop-blur">
                  <Icon aria-hidden="true" className="size-4 text-orange-300" /> {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Giriş kartı (açık zeminde de soluk süzülen simgeler; mobilde koyu sahne zaten arkada) */}
      <section className="relative z-10 flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <FloatingIcons tone="light" count={12} className="absolute inset-0 hidden lg:block" />
        <div className="ln-rise relative w-full max-w-[26rem] rounded-[1.75rem] border border-white/60 bg-white/95 p-7 shadow-[0_30px_80px_-30px_rgb(12_10_9/0.45)] backdrop-blur-2xl sm:p-9 lg:border-stone-200/70 lg:bg-white/90">
          <Link href="/" className="mx-auto mb-8 flex w-fit rounded-md" aria-label="MasaNova AI ana sayfa">
            <BrandLogo className="h-10" priority />
          </Link>

          <h1 className="text-center text-[1.75rem] font-semibold leading-tight tracking-tight text-stone-900">Tekrar hoş geldiniz</h1>
          <p className="mt-1.5 text-center text-[0.9375rem] text-stone-500">Restoran paneli ve platform yönetimi için giriş yapın.</p>

          {statusMessage ? (
            <p role="status" className="mt-6 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-3 text-sm text-warning">
              {statusMessage}
            </p>
          ) : null}

          {user && !statusMessage ? (
            <div className="mt-8 rounded-2xl border border-stone-200 bg-white/70 p-5">
              <p className="text-sm text-stone-600">
                <span className="font-medium text-stone-900">{user.email}</span> olarak oturum açık.
              </p>
              <div className="mt-4 flex gap-2">
                <Link href={user.role === "SUPER_ADMIN" ? "/admin" : "/panel"} className={buttonVariants({ size: "sm" })}>
                  Devam et <ArrowRight aria-hidden="true" />
                </Link>
                <form action={logoutAction}>
                  <Button type="submit" variant="secondary" size="sm">
                    Çıkış yap
                  </Button>
                </form>
              </div>
            </div>
          ) : (
            <LoginForm />
          )}

          <p className="mt-8 text-center text-xs text-stone-400">
            MasaNova AI · <span className="text-stone-500">3Y Tasarım &amp; Yazılım</span>
          </p>
        </div>
      </section>
    </main>
  );
}
