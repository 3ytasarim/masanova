import Link from "next/link";
import type { ReactNode } from "react";
import { AREA_BASE_PATH, type NavArea } from "@/config/navigation";
import type { Feature } from "@/config/plans";
import type { Permission } from "@/lib/permissions/roles";
import { Logo } from "@/components/layout/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";

/**
 * Admin ve restoran paneli ortak kabuğu.
 * Masaüstü (lg+): sabit sol kenar çubuğu. Mobil/tablet: üst çubuk + çekmece menü.
 */
export function DashboardShell({
  area,
  permissions,
  features,
  contextLabel,
  contextLogoUrl,
  contextMeta,
  user,
  banner,
  children,
}: {
  area: NavArea;
  permissions?: readonly Permission[];
  /** Kiracının etkin paket özellikleri (yalnızca gezinme görünümü; yetki sunucuda). */
  features?: readonly Feature[];
  /** Kenar çubuğunun üstünde gösterilen bağlam (ör. işletme adı ya da "Platform"). */
  contextLabel: string;
  /** İşletme logosu (yüklenen ya da harici); yoksa gösterilmez. */
  contextLogoUrl?: string | null;
  contextMeta?: ReactNode;
  user: { name: string; email: string; roleLabel: string };
  /** Kalıcı uyarı bandı (ör. destek modu) — her sayfada içerik alanının en üstünde. */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const brand = (
    <Link href={AREA_BASE_PATH[area]} className="rounded-md">
      <Logo suffix={area === "admin" ? "Admin" : undefined} />
    </Link>
  );

  return (
    <div className="min-h-dvh bg-surface lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-bg focus:px-4 focus:py-2.5 focus:shadow-md"
      >
        İçeriğe geç
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border lg:flex">
        <div className="flex h-16 items-center px-5">{brand}</div>
        <div className="mx-3 mb-3 flex items-center gap-2.5 rounded-md border border-border bg-bg px-3 py-2.5">
          {contextLogoUrl ? <ContextLogo src={contextLogoUrl} /> : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg">{contextLabel}</div>
            {contextMeta ? <div className="mt-0.5 truncate text-xs text-fg-subtle">{contextMeta}</div> : null}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <SidebarNav area={area} permissions={permissions} features={features} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {banner}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <MobileNav area={area} permissions={permissions} features={features} header={<Logo suffix={area === "admin" ? "Admin" : undefined} />} />
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
            {contextLogoUrl ? <ContextLogo src={contextLogoUrl} /> : null}
            <div className="truncate text-sm font-medium text-fg">{contextLabel}</div>
          </div>
          <UserMenu {...user} />
        </header>
        <main id="icerik" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

function ContextLogo({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- işletme logosu (yüklenen /media ya da harici https); sabit 28 px
    <img src={src} alt="" width={28} height={28} referrerPolicy="no-referrer" data-testid="panel-logo" className="size-7 shrink-0 rounded object-contain" />
  );
}
