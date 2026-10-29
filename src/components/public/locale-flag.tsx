/**
 * Menü dilleri için yuvarlak bayraklar (satır içi SVG — emoji bayraklar Windows'ta görünmez, harici görsel yok).
 * Dil ≠ ülke: bayrak yalnızca tanıma kolaylığı içindir; erişilebilir ad dil adından gelir (bayrak aria-hidden).
 */
export function LocaleFlag({ locale, className }: { locale: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-black/10 ${className ?? "size-6"}`}>
      <svg viewBox="0 0 24 24" className="block size-full" preserveAspectRatio="xMidYMid slice">
        {FLAGS[locale] ?? <rect width="24" height="24" fill="#a8a29e" />}
      </svg>
    </span>
  );
}

const FLAGS: Record<string, React.ReactNode> = {
  tr: (
    <>
      <rect width="24" height="24" fill="#E30A17" />
      <circle cx="9.6" cy="12" r="5" fill="#fff" />
      <circle cx="10.8" cy="12" r="4" fill="#E30A17" />
      <path d="M15.6 12l-3.1 1 1.9-2.6v3.2l-1.9-2.6z" fill="#fff" />
    </>
  ),
  en: (
    <>
      <rect width="24" height="24" fill="#012169" />
      <path d="M0 0l24 24M24 0L0 24" stroke="#fff" strokeWidth="4.8" />
      <path d="M0 0l24 24M24 0L0 24" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M12 0v24M0 12h24" stroke="#fff" strokeWidth="8" />
      <path d="M12 0v24M0 12h24" stroke="#C8102E" strokeWidth="4.8" />
    </>
  ),
  de: (
    <>
      <rect width="24" height="8" fill="#000" />
      <rect y="8" width="24" height="8" fill="#DD0000" />
      <rect y="16" width="24" height="8" fill="#FFCE00" />
    </>
  ),
  ar: (
    <>
      <rect width="24" height="24" fill="#006C35" />
      <path d="M6 10.2h12M7.5 8.4h9" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" opacity="0.95" />
      <path d="M6.5 14.6h10.2l1.3-.7" stroke="#fff" strokeWidth="1" strokeLinecap="round" fill="none" />
    </>
  ),
  ru: (
    <>
      <rect width="24" height="8" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#0039A6" />
      <rect y="16" width="24" height="8" fill="#D52B1E" />
    </>
  ),
};
