"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { CTA, NAV } from "@/content/marketing/copy";
import { cn } from "@/lib/utils/cn";
import { BrandLogo } from "@/components/layout/logo";

/**
 * Pazarlama başlığı: hero üzerinde şeffaf, kaydırınca koyu cam yüzey (kontrast korunur). Mobilde erişilebilir menü
 * (aria-expanded / Escape / bağlantıyla kapanır). Super Admin bağlantısı YOK; yalnızca /giris.
 */
export function SiteHeader() {
  const scrolled = useSyncExternalStore(subscribeScroll, () => window.scrollY > 24, () => false);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      data-testid="site-header"
      data-scrolled={scrolled || open ? "" : undefined}
      className={cn(
        "mk-dark fixed inset-x-0 text-fg top-0 z-50 border-b transition-[background-color,border-color,height] duration-300",
        scrolled || open ? "border-white/10 bg-[#0c0a09]/85 backdrop-blur-xl" : "border-transparent bg-transparent",
      )}
    >
      <div className={cn("mx-auto flex max-w-7xl items-center gap-6 px-4 transition-[height] duration-300 sm:px-6 lg:px-8", scrolled ? "h-14" : "h-16 lg:h-20")}>
        <Link href="/" aria-label="MasaNova AI ana sayfa" className="inline-flex items-center rounded-md">
          <BrandLogo variant="dark" priority className={cn("transition-[height] duration-300", scrolled ? "h-7" : "h-8 lg:h-9")} />
        </Link>
        <nav aria-label="Ana menü" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="rounded-md px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Link href="/giris" data-track="MARKETING_LOGIN_CLICK" data-track-placement="header" className="hidden rounded-md px-3 py-2 text-sm font-medium text-white/80 hover:text-white sm:inline-flex">
            {CTA.login}
          </Link>
          <a
            href="#demo"
            data-track="MARKETING_DEMO_CTA"
            data-track-placement="header"
            className="inline-flex h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-stone-950 shadow-sm transition-colors hover:bg-stone-200"
          >
            {CTA.demoShort}
          </a>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full text-white hover:bg-white/10 lg:hidden"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </button>
        </div>
      </div>
      <div id={panelId} hidden={!open} className="border-t border-white/10 px-4 pb-5 pt-2 sm:px-6 lg:hidden">
        <nav aria-label="Mobil menü">
          <ul className="grid">
            {NAV.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center border-b border-white/5 text-base font-medium text-white/85">
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/giris" data-track="MARKETING_LOGIN_CLICK" data-track-placement="mobile-menu" className="flex min-h-12 items-center text-base font-medium text-white/85">
                {CTA.login}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}
