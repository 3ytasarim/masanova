"use client";

/* eslint-disable @next/next/no-img-element -- işletmenin harici https görselleri; next/image uzak desen listesi gerektirir */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Ürün / kapak görseli: tembel yükleme, sabit oran (düzen kayması yok), yüklenirken yumuşak zemin,
 * hata durumunda görsel tamamen kaldırılır (kırık görsel simgesi asla gösterilmez). Token'lı sayfa adresi
 * harici görsel sunucusuna Referer ile sızmasın diye no-referrer.
 */
export function ProductImage({
  src,
  srcSet,
  alt,
  className,
  priority = false,
  sizes,
  onMissing,
}: {
  src: string;
  /** Yüklenen görsellerin boyut çeşitleri ("…/sm.webp 400w, …/md.webp 900w"); `sizes` ile birlikte. */
  srcSet?: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
  onMissing?: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // Görsel hidrasyondan önce yüklendiyse (önbellek) onLoad kaçırılır — bağlanınca durumu kendimiz okuruz.
  useEffect(() => {
    const img = ref.current;
    if (!img?.complete) return;
    if (img.naturalWidth > 0) setState("ready");
    else {
      setState("error");
      onMissing?.();
    }
  }, [onMissing]);

  if (state === "error") return null;
  return (
    <img
      ref={ref}
      src={src}
      srcSet={srcSet ?? undefined}
      alt={alt}
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => setState("ready")}
      onError={() => {
        setState("error");
        onMissing?.();
      }}
      className={cn("size-full object-cover transition-opacity duration-300 motion-reduce:transition-none", state === "ready" ? "opacity-100" : "opacity-0", className)}
    />
  );
}
