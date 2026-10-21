import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "@/server/actions/auth.actions";
import { Logo } from "@/components/layout/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Giriş",
  robots: { index: false, follow: false },
};

const STATUS_MESSAGES: Record<string, string> = {
  "isletme-pasif": "İşletme hesabınız şu anda aktif değil. Lütfen MasaNova destek ekibiyle iletişime geçin.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ durum?: string | string[] }> }) {
  const { durum } = await searchParams;
  const statusMessage = typeof durum === "string" ? STATUS_MESSAGES[durum] : undefined;
  const user = await getCurrentUser();

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
        <Link href="/" className="mb-10 self-start rounded-md" aria-label="MasaNova AI ana sayfa">
          <Logo />
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Hesabınıza giriş yapın</h1>
        <p className="mt-1.5 text-sm text-fg-subtle">Restoran paneli ve platform yönetimi için.</p>

        {statusMessage ? (
          <p role="status" className="mt-6 rounded-md border border-warning/25 bg-warning-soft px-3.5 py-3 text-sm text-warning">
            {statusMessage}
          </p>
        ) : null}

        {user && !statusMessage ? (
          <div className="mt-8 rounded-lg border border-border bg-bg p-5 shadow-xs">
            <p className="text-sm text-fg-muted">
              <span className="font-medium text-fg">{user.email}</span> olarak oturum açık.
            </p>
            <div className="mt-4 flex gap-2">
              <Link href={user.role === "SUPER_ADMIN" ? "/admin" : "/panel"} className={buttonVariants({ size: "sm" })}>
                Devam et
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
      </div>
    </main>
  );
}
