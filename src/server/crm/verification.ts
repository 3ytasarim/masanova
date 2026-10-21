import "server-only";
import type { ContactChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import { codeMatches, hashVerificationCode, newCustomerPublicId, newVerificationCode, VERIFICATION_MAX_ATTEMPTS, VERIFICATION_TTL_MS } from "@/lib/crm/session";
import { mocksAllowed } from "@/lib/runtime-profile";

/**
 * İletişim doğrulaması — SAĞLAYICI SOYUTLAMASI. Bu sprintte gerçek SMS / e-posta sağlayıcısı YOK:
 *   - CONTACT_VERIFICATION_PROVIDER boş (varsayılan) → doğrulama KAPALI. Katılım "doğrulanmamış iletişim" olarak kaydedilir,
 *     mevcut bir müşteriyle ASLA birleştirilmez ve sahte "doğrulandı" işareti konmaz.
 *   - "mock" → yalnızca test / geliştirme: hiçbir şey gönderilmez, kod CONTACT_VERIFICATION_MOCK_CODE'dur. Üretim
 *     derlemesinde mock YOK SAYILIR (doğrulama kapalı kalır).
 * Kural: kod yalnızca özet (QR_TOKEN_SECRET ile) olarak saklanır, LOGLANMAZ; 10 dk geçerli, en fazla 5 deneme, tek kullanımlık.
 * Gönderim sayısı hız sınırıyla (iletişim değeri + IP başına) kısıtlanır — bkz. crm.verify.* politikaları.
 */
export type VerificationProvider = {
  name: "mock";
  /** Kodu müşteriye iletir. Mock: hiçbir şey göndermez. Gerçek sağlayıcı burada eklenecek. */
  deliver(channel: ContactChannel, valueNormalized: string, code: string): Promise<boolean>;
  /** Test sağlayıcısı sabit kod kullanır. */
  fixedCode: string | null;
};

export function getVerificationProvider(): VerificationProvider | null {
  const env = getServerEnv();
  if (env.CONTACT_VERIFICATION_PROVIDER === "mock" && mocksAllowed() && env.CONTACT_VERIFICATION_MOCK_CODE) {
    return { name: "mock", fixedCode: env.CONTACT_VERIFICATION_MOCK_CODE, deliver: async () => true };
  }
  return null;
}

export function verificationAvailable(): boolean {
  return getVerificationProvider() !== null;
}

/** Bekleyen katılım verisi (doğrulama sonrası uygulanır). İletişim değeri ayrıca normalize edilmiş olarak saklanır. */
export type PendingJoin = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  consents: string[];
  source: "QR_OPT_IN" | "ORDER_CHECKOUT" | "LOYALTY_JOIN";
  language: string;
};

export async function startVerification(tenantId: string, channel: ContactChannel, valueNormalized: string, payload: PendingJoin): Promise<{ ok: true; publicId: string } | { ok: false }> {
  const provider = getVerificationProvider();
  if (!provider) return { ok: false };
  const publicId = newCustomerPublicId();
  const code = provider.fixedCode ?? newVerificationCode();
  const secret = getServerEnv().QR_TOKEN_SECRET;
  // Saklama: 24 saatten eski doğrulama kayıtları (bekleyen katılım verisi dahil) silinir.
  await prisma.contactVerification.deleteMany({ where: { tenantId, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  // Aynı iletişim için önceki bekleyen kodlar geçersiz olur (yalnızca son kod çalışır).
  await prisma.contactVerification.updateMany({ where: { tenantId, channel, valueNormalized, consumedAt: null }, data: { consumedAt: new Date() } });
  await prisma.contactVerification.create({
    data: { tenantId, publicId, channel, valueNormalized, codeHash: hashVerificationCode(code, secret, publicId), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS), payload: payload as unknown as Prisma.InputJsonValue },
  });
  if (!(await provider.deliver(channel, valueNormalized, code))) return { ok: false };
  return { ok: true, publicId };
}

export type ConsumeResult = { ok: true; channel: ContactChannel; valueNormalized: string; payload: PendingJoin } | { ok: false; reason: "invalid" | "expired" | "locked" };

/**
 * Kod denetimi. Deneme sayacı ÖNCE atomik artırılır (sınır aşılmışsa / süresi dolmuşsa / kullanılmışsa denenmez); kod
 * doğruysa tek kullanımlık tüketim yine koşullu güncellemedir (eşzamanlı iki doğru istekten yalnızca biri kazanır).
 */
export async function consumeVerification(tenantId: string, publicId: string, code: string): Promise<ConsumeResult> {
  const now = new Date();
  const bumped = await prisma.contactVerification.updateMany({
    where: { tenantId, publicId, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: VERIFICATION_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  const row = await prisma.contactVerification.findFirst({ where: { tenantId, publicId }, select: { id: true, channel: true, valueNormalized: true, codeHash: true, payload: true, expiresAt: true, attempts: true } });
  if (!row) return { ok: false, reason: "invalid" };
  if (bumped.count !== 1) return { ok: false, reason: row.expiresAt <= now ? "expired" : "locked" };
  if (!/^\d{6}$/.test(code) || !codeMatches(code, row.codeHash, getServerEnv().QR_TOKEN_SECRET, publicId)) {
    return { ok: false, reason: row.attempts >= VERIFICATION_MAX_ATTEMPTS ? "locked" : "invalid" };
  }
  const consumed = await prisma.contactVerification.updateMany({ where: { id: row.id, tenantId, consumedAt: null }, data: { consumedAt: now } });
  if (consumed.count !== 1) return { ok: false, reason: "expired" };
  return { ok: true, channel: row.channel, valueNormalized: row.valueNormalized, payload: row.payload as unknown as PendingJoin };
}
