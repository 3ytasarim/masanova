"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { REDUCED_MOTION_QUERY, shouldAnimate } from "@/lib/marketing/motion";

/** Hareket tercihi (azaltılmış hareket + veri tasarrufu) — değişince yeniden çizer. Sunucu: hareket serbest varsayılır. */
function subscribe(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function snapshot(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return shouldAnimate({ matchMedia: (q) => window.matchMedia(q), saveData: connection?.saveData });
}
export function useMotionAllowed(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

/**
 * Pazarlama demoları için adım döngüsü. Yalnızca bölüm GÖRÜNÜRKEN ve sekme açıkken ilerler (görünmeyen demo CPU
 * harcamaz); hareket azaltma / veri tasarrufunda hiç ilerlemez ve `finalStep` gösterilir (bilgi kaybı yok).
 * `durations[i]`: i. adımda bekleme (ms). `loop` false ise son adımda durur.
 */
export function useDemoLoop<T extends HTMLElement>(durations: readonly number[], options: { loop?: boolean; finalStep?: number } = {}) {
  const { loop = true, finalStep = durations.length - 1 } = options;
  const ref = useRef<T>(null);
  const animate = useMotionAllowed();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    const onVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    let io: IntersectionObserver | null = null;
    if (el && "IntersectionObserver" in window) {
      io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: 0.2 });
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const running = animate && visible && pageVisible;
  useEffect(() => {
    if (!running) return;
    if (step >= durations.length - 1 && !loop) return;
    const timer = window.setTimeout(() => setStep((s) => (s >= durations.length - 1 ? 0 : s + 1)), durations[step] ?? 1000);
    return () => window.clearTimeout(timer);
  }, [running, step, durations, loop]);

  return { ref, step: animate ? step : finalStep, paused: !running, animate, restart: () => setStep(0) };
}
