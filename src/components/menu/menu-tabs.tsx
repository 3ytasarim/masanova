"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/panel/menu", label: "Genel Bakış", exact: true },
  { href: "/panel/menu/kategoriler", label: "Kategoriler" },
  { href: "/panel/menu/urunler", label: "Ürünler" },
  { href: "/panel/menu/ekstralar", label: "Ekstralar" },
  { href: "/panel/menu/kutuphane", label: "Malzeme & Alerjen" },
] as const;

export function MenuTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Menü bölümleri" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const active = "exact" in tab ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
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
