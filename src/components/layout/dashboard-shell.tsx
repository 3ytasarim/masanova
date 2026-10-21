import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { FloatingIcons } from "@/components/brand/floating-icons";
import { AREA_BASE_PATH, type NavArea } from "@/config/navigation";
import type { Feature } from "@/config/plans";
import type { Permission } from "@/lib/permissions/roles";
import { Logo } from "@/components/layout/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";

/**
 * Admin ve restoran paneli ortak kabuğu — açık "cam" tasarım (site renkleri: turuncu → kırmızı).
 * Masaüstü (lg+): sıcak tonlu arka plan + süzülen restoran simgeleri üzerinde yüzen cam kenar çubuğu ve cam üst çubuk.
 * Mobil / tablet: cam üst çubuk + çekmece menü. İçerik kartları (Card / StatCard / Table) aynı cam yüzeyi kullanır.
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
  /** İşletme logosu (yüklenen ya da harici); yoksa baş harfler gösterilir. */
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
  const today = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Istanbul" }).format(new Date());

  return (
    <div className="mn-shell-bg relative isolate min-h-dvh lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      {/* Arka katman: süzülen restoran simgeleri (dekoratif, içeriğin arkasında) */}
      <FloatingIcons tone="light" count={14} className="fixed inset-0 -z-10" />
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-bg focus:px-4 focus:py-2.5 focus:shadow-md"
      >
        İçeriğe geç
      </a>

      {/* Yüzen cam kenar çubuğu */}
      <aside className="sticky top-0 hidden h-dvh p-3 pr-0 lg:block">
        <div className="mn-glass flex h-full flex-col rounded-[1.75rem]">
          <div className="flex h-16 items-center px-5">{brand}</div>
          <div className="mx-3 mb-3 flex items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-3 py-2.5 shadow-[0_6px_18px_-12px_rgb(124_45_18/0.35)]" data-testid="sidebar-context">
            <ContextBadge src={contextLogoUrl} label={contextLabel} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-stone-900">{contextLabel}</div>
              {contextMeta ? <div className="mt-0.5 truncate text-xs text-stone-500">{contextMeta}</div> : null}
            </div>
          </div>
          <div className="mn-scroll flex-1 overflow-y-auto px-3 pb-4">
            <SidebarNav area={area} permissions={permissions} features={features} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {banner}
        {/* Cam üst çubuk */}
        <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 lg:px-6">
          <div className="mn-glass flex h-16 items-center gap-3 rounded-2xl px-3 sm:px-4">
            <MobileNav area={area} permissions={permissions} features={features} header={<Logo suffix={area === "admin" ? "Admin" : undefined} />} />
            {/* Mobil / tablet: işletme */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:hidden">
              <ContextBadge src={contextLogoUrl} label={contextLabel} small />
              <div className="truncate text-sm font-semibold text-stone-900">{contextLabel}</div>
            </div>
            {/* Masaüstü: bölüm + tarih */}
            <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
              <span className="rounded-full bg-[linear-gradient(135deg,rgb(234_88_12/0.12),rgb(220_38_38/0.10))] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">
                {area === "admin" ? "Platform Yönetimi" : "İşletme Paneli"}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3.5 py-1.5 text-sm text-stone-600" data-testid="header-date">
                <CalendarDays aria-hidden="true" className="size-4 text-orange-600" />
                <span className="first-letter:uppercase">{today}</span>
              </span>
            </div>
            <UserMenu {...user} />
          </div>
        </header>
        <main id="icerik" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** İşletme logosu; yoksa marka geçişli baş harf rozeti. */
function ContextBadge({ src, label, small = false }: { src?: string | null; label: string; small?: boolean }) {
  const size = small ? "size-8" : "size-10";
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- işletme logosu (yüklenen /media ya da harici https); sabit boyut
      <img src={src} alt="" width={40} height={40} referrerPolicy="no-referrer" data-testid="panel-logo" className={`${size} shrink-0 rounded-xl bg-white object-contain p-0.5 ring-1 ring-stone-200/70`} />
    );
  const initials = label
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("tr-TR");
  return (
    <span aria-hidden="true" className={`${size} grid shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-xs font-bold text-white shadow-[0_6px_14px_-6px_rgb(220_38_38/0.6)]`}>
      {initials}
    </span>
  );
}
