"use client";

import { useEffect, useRef, useState } from "react";

/** İşletme logosu (kenar çubuğu / üst çubuk). Logo yoksa ya da dosyası açılamazsa marka geçişli baş harf rozeti. */
export function ContextBadge({ src, label, small = false }: { src?: string | null; label: string; small?: boolean }) {
  const size = small ? "size-8" : "size-10";
  const [broken, setBroken] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // Hidrasyondan önce hata veren görselde onError kaçar.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setBroken(true);
  }, [src]);

  if (src && !broken)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- işletme logosu (yüklenen /media ya da harici https); sabit boyut
      <img ref={imgRef} src={src} alt="" width={40} height={40} referrerPolicy="no-referrer" onError={() => setBroken(true)} data-testid="panel-logo" className={`${size} shrink-0 rounded-xl bg-white object-contain p-0.5 ring-1 ring-stone-200/70`} />
    );
  const initials = label
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("tr-TR");
  return (
    <span aria-hidden="true" className={`${size} grid shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-xs font-bold text-white shadow-[0_6px_14px_-6px_rgb(220_38_38/0.6)]`}>
      {initials}
    </span>
  );
}
