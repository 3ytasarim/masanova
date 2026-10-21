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
      <ul className="flex flex-col gap-0.5">
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
                  "group flex min-h-10 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors duration-(--duration-fast)",
                  active ? "bg-bg text-fg shadow-xs ring-1 ring-border" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon aria-hidden="true" className={cn("size-4 shrink-0", active ? "text-accent-strong" : "text-fg-subtle group-hover:text-fg-muted")} />
                <span className="truncate">{item.label}</span>
                {state === "locked" && item.feature ? (
                  <span className="ml-auto shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-fg-subtle" data-testid="nav-plan-badge">
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
