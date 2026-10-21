import Link from "next/link";
import { FOOTER } from "@/content/marketing/copy";
import { siteConfig } from "@/config/site";
import { BrandLogo } from "@/components/layout/logo";

export function SiteFooter() {
  return (
    <footer className="mk-dark border-t border-white/10 bg-bg text-fg">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="max-w-sm">
          <BrandLogo variant="dark" className="h-9" />
          <p className="mt-4 text-sm leading-relaxed text-fg-subtle">{FOOTER.tagline}</p>
        </div>
        {FOOTER.columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-sm font-semibold">{col.title}</h2>
            <ul className="mt-4 grid gap-2.5">
              {col.links.map((l) =>
                l.href.startsWith("/") ? (
                  <li key={l.href}>
                    <Link href={l.href} data-track="MARKETING_LOGIN_CLICK" data-track-placement="footer" className="text-sm text-fg-subtle hover:text-fg">
                      {l.label}
                    </Link>
                  </li>
                ) : (
                  <li key={l.href}>
                    <a href={l.href} className="text-sm text-fg-subtle hover:text-fg">
                      {l.label}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-6 text-xs text-fg-subtle sm:px-6 lg:px-8">
          © {new Date().getFullYear()} {siteConfig.company} · {siteConfig.name}
        </p>
      </div>
    </footer>
  );
}
