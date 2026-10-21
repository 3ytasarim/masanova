import { publicEnv } from "@/lib/env.public";
import { normalizeHost } from "@/lib/domain/normalize-domain";

/**
 * Platform kök alanı — NEXT_PUBLIC_ROOT_DOMAIN'den türetilir, kodda hiçbir yerde sabit alan adı yazılmaz.
 *   geliştirme: "localhost:3000"  → ROOT_HOSTNAME "localhost", ROOT_PORT "3000"
 *   üretim:     "masanovai.com"   → ROOT_HOSTNAME "masanovai.com", ROOT_PORT null
 */
const raw = publicEnv.NEXT_PUBLIC_ROOT_DOMAIN.trim().toLowerCase();
const hostname = normalizeHost(raw);
if (!hostname) {
  throw new Error("NEXT_PUBLIC_ROOT_DOMAIN geçerli bir alan adı değil.");
}

export const ROOT_HOSTNAME: string = hostname;
export const ROOT_PORT: string | null = raw.includes(":") ? (raw.split(":")[1] ?? null) : null;
