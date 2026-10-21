"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

/** Masalar bölümü sekmeleri. Etiket tasarımcısı QR adresi içerdiğinden yalnızca yönetim yetkisiyle görünür. */
export function TablesTabs({ showLabels }: { showLabels: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/panel/masalar", label: "Masalar", active: pathname === "/panel/masalar" || (/^\/panel\/masalar\/[a-z0-9]{20,40}$/.test(pathname)) },
    ...(showLabels ? [{ href: "/panel/masalar/etiketler", label: "QR Etiketleri", active: pathname.startsWith("/panel/masalar/etiketler") }] : []),
  ];
  return (
    <nav aria-label="Masa bölümleri" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {tabs.map((tab) => (
          <li key={tab.href} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                tab.active ? "border-fg text-fg" : "border-transparent text-fg-subtle hover:text-fg",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
