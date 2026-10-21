import "server-only";
import { headers } from "next/headers";
import { CORRELATION_HEADER, isValidCorrelationId } from "@/lib/observability/correlation";

export type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

const MAX_UA_LENGTH = 512;

/**
 * Denetim ve hız sınırlama için istemci bilgisi.
 * x-forwarded-for yalnızca güvenilir bir ters vekil (Vercel / Cloudflare) arkasında anlamlıdır; bu değer
 * YETKİLENDİRME için asla kullanılmaz, sadece kayıt ve throttling anahtarı olarak kullanılır.
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip")?.trim() || null;
  const ua = h.get("user-agent");
  return {
    ipAddress: ip && ip.length <= 64 ? ip : null,
    userAgent: ua ? ua.slice(0, MAX_UA_LENGTH) : null,
  };
}

/**
 * İlişkilendirme kimliği (proxy ekler; log zinciri için — sır değildir). RequestMeta'dan AYRI tutulur: RequestMeta
 * oturum / denetim satırlarına olduğu gibi yazılır.
 */
export async function getRequestId(): Promise<string | null> {
  const id = (await headers()).get(CORRELATION_HEADER);
  return isValidCorrelationId(id) ? id : null;
}
