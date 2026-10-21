import { publicEnv } from "@/lib/env.public";

/** Platformun (pazarlama + /admin + /panel) mutlak adresi. Tüm platform URL'leri buradan üretilir. */
export const PLATFORM_ORIGIN: string = new URL(publicEnv.NEXT_PUBLIC_APP_URL).origin;

/** getPlatformUrl("/panel") → "https://masanovai.com/panel" */
export function getPlatformUrl(path = "/"): string {
  return new URL(path, PLATFORM_ORIGIN).toString();
}
