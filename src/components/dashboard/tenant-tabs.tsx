"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { segment: "", label: "Genel" },
  { segment: "subeler", label: "Şubeler" },
  { segment: "domainler", label: "Domainler" },
  { segment: "kullanicilar", label: "Kullanıcılar" },
  { segment: "plan", label: "Abonelik & Plan" },
  { segment: "audit", label: "Audit" },
] as const;

/** İşletme detay sekmeleri — her sekme ayrı rota (sunucu tarafı veri, paylaşılabilir URL). */
export function TenantTabs({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const base = `/admin/isletmeler/${tenantId}`;
  return (
    <nav aria-label="İşletme sekmeleri" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = tab.segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
          return (
            <li key={tab.segment} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                  active ? "border-fg text-fg" : "border-transparent text-fg-subtle hover:text-fg",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
