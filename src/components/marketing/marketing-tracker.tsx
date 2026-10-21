"use client";

import { useEffect } from "react";
import { trackMarketing } from "@/lib/marketing/events";

/** `data-track` işaretli bağlantı / düğme tıklamalarını tipli pazarlama olayına çevirir (üçüncü taraf yok). */
export function MarketingTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-track]");
      if (el) trackMarketing(window, el.dataset.track ?? "", el.dataset.trackPlacement);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
