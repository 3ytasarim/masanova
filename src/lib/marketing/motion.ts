/**
 * Pazarlama sayfası hareket yardımcıları (saf; tarayıcı API'si parametre olarak verilir → birim testli).
 * İlke: içerik HTML'de her zaman vardır; hareket yalnızca ilerleyici iyileştirmedir. Hareket azaltma tercihi,
 * veri tasarrufu ve görünmeyen sekme / bölüm hareketi durdurur.
 */
export type MotionEnv = {
  matchMedia?: (query: string) => { matches: boolean };
  /** navigator.connection.saveData */
  saveData?: boolean;
};

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(env: MotionEnv): boolean {
  try {
    return !!env.matchMedia?.(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** Döngüsel / sürekli demo animasyonu çalışmalı mı? (azaltılmış harekette ve veri tasarrufunda HAYIR → son kare gösterilir) */
export function shouldAnimate(env: MotionEnv): boolean {
  return !prefersReducedMotion(env) && !env.saveData;
}

/** Paralaks yalnızca geniş ekranda ve hareket serbestken (mobilde / düşük güçte kapalı). */
export function shouldParallax(env: MotionEnv & { width: number }): boolean {
  return shouldAnimate(env) && env.width >= 1024;
}

/** Paralaks kayması: görünür alandaki konuma göre küçük, sınırlı piksel değeri (baş dönmesi yok). */
export function parallaxOffset(progress: number, strength = 24): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.round((0.5 - p) * strength * 2 * 10) / 10;
}
