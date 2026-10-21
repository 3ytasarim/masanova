import { PLATFORM_ORIGIN } from "@/lib/domain/get-platform-url";
import { normalizeHost } from "@/lib/domain/normalize-domain";

/**
 * Kararlı (stable) QR giriş adresi — basılı etiketlerin kodladığı TEK adres:
 *
 *   <QR_ENTRY_ORIGIN>/q/<token>        ör. https://go.masanovai.com/q/<token>
 *
 * Kiracının alt alan adı / özel alan adı değişebilir; basılı etiket yıllarca masada kalır. Bu yüzden etiket kiracı
 * alan adını DEĞİL, platformun değişmeyen giriş adresini kodlar. Giriş adresi token'ı doğrular ve kiracının O ANKİ
 * birincil alan adına geçici (307) yönlendirir — alan adı hiçbir yerde kalıcı olarak "basılmaz".
 *
 * QR_ENTRY_ORIGIN verilmezse platform origin'i (NEXT_PUBLIC_APP_URL) kullanılır (yerel geliştirme).
 * Bu değer bir kez seçildikten sonra DEĞİŞTİRİLMEMELİDİR (basılı etiketler ona bağlıdır).
 */
export function resolveQrEntryOrigin(raw: string | undefined, fallback: string, production = process.env.NODE_ENV === "production"): string {
  const value = raw?.trim();
  if (!value) return new URL(fallback).origin;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("QR_ENTRY_ORIGIN geçerli bir adres değil (ör. https://go.masanovai.com).");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("QR_ENTRY_ORIGIN http(s) olmalı.");
  if (production && url.protocol !== "https:") throw new Error("QR_ENTRY_ORIGIN üretimde https olmalı.");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("QR_ENTRY_ORIGIN yalnızca origin olmalı (yol, sorgu, kimlik bilgisi içermemeli).");
  }
  return url.origin;
}

export const QR_ENTRY_ORIGIN: string = resolveQrEntryOrigin(process.env.QR_ENTRY_ORIGIN, PLATFORM_ORIGIN);
export const QR_ENTRY_HOSTNAME: string = new URL(QR_ENTRY_ORIGIN).hostname;
/** Giriş adresi ayrı bir host mu (prod: go.masanovai.com) yoksa platformun kendisi mi (yerel)? */
export const QR_ENTRY_IS_DEDICATED_HOST: boolean = QR_ENTRY_HOSTNAME !== new URL(PLATFORM_ORIGIN).hostname;

export const QR_ENTRY_PATH_PREFIX = "/q/";

/** Basılı QR'ın kodladığı kanonik adres. */
export function buildStableQrUrl(token: string, origin: string = QR_ENTRY_ORIGIN): string {
  return `${origin}${QR_ENTRY_PATH_PREFIX}${token}`;
}

export function isQrEntryHost(rawHost: string | null | undefined): boolean {
  return normalizeHost(rawHost) === QR_ENTRY_HOSTNAME;
}
