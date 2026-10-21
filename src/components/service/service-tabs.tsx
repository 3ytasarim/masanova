"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

/** Servis bölümü sekmeleri: canlı pano / geçmiş. */
export function ServiceTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/panel/servis", label: "Canlı Pano", active: pathname === "/panel/servis" },
    { href: "/panel/servis/gecmis", label: "Geçmiş", active: pathname.startsWith("/panel/servis/gecmis") },
  ];
  return (
    <nav aria-label="Servis bölümleri" className="-mx-4 mb-5 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {tabs.map((tab) => (
          <li key={tab.href} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn("-mb-px inline-flex h-12 items-center border-b-2 px-3 text-sm font-medium transition-colors", tab.active ? "border-fg text-fg" : "border-transparent text-fg-subtle hover:text-fg")}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
