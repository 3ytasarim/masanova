"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

/** AI bölümü sekmeleri: müşteri sesli asistanı ve işletme danışmanı AYRI bağlamlardır (ayrı istem, ayrı kullanım). */
export function AiTabs({ voice, advisor }: { voice: boolean; advisor: boolean }) {
  const pathname = usePathname();
  const tabs = [
    ...(voice ? [{ href: "/panel/ai", label: "Sesli Asistan", active: pathname === "/panel/ai" }] : []),
    ...(voice ? [{ href: "/panel/ai/menu-egitimi", label: "Menü Eğitimi", active: pathname.startsWith("/panel/ai/menu-egitimi") }] : []),
    ...(voice ? [{ href: "/panel/ai/eslestirmeler", label: "Eşleştirmeler", active: pathname.startsWith("/panel/ai/eslestirmeler") }] : []),
    ...(advisor ? [{ href: "/panel/ai/danisman", label: "İşletme Danışmanı", active: pathname.startsWith("/panel/ai/danisman") }] : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="AI bölümleri" className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {tabs.map((tab) => (
          <li key={tab.href} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn("-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors", tab.active ? "border-fg text-fg" : "border-transparent text-fg-subtle hover:text-fg")}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
