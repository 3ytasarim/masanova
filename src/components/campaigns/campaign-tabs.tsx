"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/panel/kampanyalar", label: "Kampanyalar", match: (p: string) => p === "/panel/kampanyalar" || (/^\/panel\/kampanyalar\/(?!kuponlar|oduller)/.test(p)) },
  { href: "/panel/kampanyalar/kuponlar", label: "Kuponlar", match: (p: string) => p.startsWith("/panel/kampanyalar/kuponlar") },
  { href: "/panel/kampanyalar/oduller", label: "Sadakat Ödülleri", match: (p: string) => p.startsWith("/panel/kampanyalar/oduller") },
];

export function CampaignTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Kampanya bölümleri" className="-mx-1 mb-6 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium", active ? "border-accent text-fg" : "border-transparent text-fg-subtle hover:text-fg")}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
