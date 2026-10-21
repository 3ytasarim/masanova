"use client";

import { useEffect } from "react";

/**
 * Tek gözlemci: sunucuda `data-reveal` ile işaretlenmiş öğeler görünüm alanına girince `data-shown` alır (bir kez).
 * Öğeleri istemci bileşenine sarmaya gerek yok → pazarlama metni sunucuda kalır, JS minimum.
 */
export function RevealObserver() {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-shown])"));
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.setAttribute("data-shown", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
