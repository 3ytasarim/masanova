"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_BY_AREA, navHref, navState, type NavArea } from "@/config/navigation";
import { PLANS, minimumPlanFor, type Feature } from "@/config/plans";
import type { Permission } from "@/lib/permissions/roles";
import { cn } from "@/lib/utils/cn";

/**
 * Kenar çubuğu bağlantıları (masaüstü sidebar ve mobil çekmece ortak kullanır).
 * `permissions`: sunucudan gelen, kullanıcının sahip olduğu yetkiler — yalnızca görünürlük içindir.
 */
export function SidebarNav({
  area,
  permissions,
  features,
  onNavigate,
}: {
  area: NavArea;
  permissions?: readonly Permission[];
  features?: readonly Feature[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = NAV_BY_AREA[area].map((item) => ({ item, state: navState(item, { permissions, features }) })).filter((x) => x.state !== "hidden");

  return (
    <nav aria-label={area === "admin" ? "Yönetim menüsü" : "Panel menüsü"}>
      <ul className="flex flex-col gap-1">
        {items.map(({ item, state }) => {
          const href = navHref(area, item);
          const active = item.segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;
          const Icon = item.icon;
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                data-nav-state={state}
                className={cn(
                  "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200",
                  active
                    ? "bg-white text-stone-900 shadow-[inset_0_1px_0_rgb(255_255_255),0_8px_20px_-12px_rgb(124_45_18/0.45)] ring-1 ring-white"
                    : "text-stone-600 hover:-translate-y-px hover:bg-white/60 hover:text-stone-900",
                )}
              >
                {active ? <span aria-hidden="true" className="absolute -left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,#f97316,#dc2626)] shadow-[0_0_10px_rgb(249_115_22/0.7)]" /> : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
                    active ? "bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-white shadow-[0_6px_14px_-6px_rgb(220_38_38/0.6)]" : "bg-white/50 text-stone-500 group-hover:bg-white group-hover:text-orange-600",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="truncate">{item.label}</span>
                {state === "locked" && item.feature ? (
                  <span className="ml-auto shrink-0 rounded-full bg-stone-900/5 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-fg-subtle" data-testid="nav-plan-badge">
                    <span className="sr-only">Kilitli — </span>
                    {PLANS[minimumPlanFor(item.feature)].label}
                  </span>
                ) : item.sprint ? (
                  <span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-border-strong" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
