import "server-only";
import { createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { createMockProvider } from "@/server/payments/providers/mock";
import type { PaymentProvider } from "@/server/payments/providers/types";
import { mocksAllowed } from "@/lib/runtime-profile";

/**
 * Yapılandırılmış ödeme sağlayıcısı. PAYMENT_PROVIDER boş → online ödeme YOK (QR'da ödeme düğmesi gizlenir; hesap
 * isteme servis talebi aynen çalışır). Gerçek sağlayıcı adaptörü HENÜZ yok — gerçek ödeme DOĞRULANMADI.
 * Sırlar (PAYMENT_API_KEY, PAYMENT_WEBHOOK_SECRET) yalnızca sunucuda; tarayıcıya yalnızca PAYMENT_PUBLIC_KEY gidebilir.
 */
let cached: { key: string; provider: PaymentProvider | null } | null = null;

export function webhookSecret(): string {
  const env = getServerEnv();
  // Test sağlayıcısında sır verilmemişse QR sırrından türetilir (gerçek sağlayıcıda ZORUNLU).
  return env.PAYMENT_WEBHOOK_SECRET || createHmac("sha256", env.QR_TOKEN_SECRET).update("masanova.mock-payment-webhook.v1").digest("hex");
}

export function getPaymentProvider(): PaymentProvider | null {
  const env = getServerEnv();
  const allowMock = mocksAllowed();
  const key = `${env.PAYMENT_PROVIDER ?? ""}|${allowMock}`;
  if (cached?.key === key) return cached.provider;
  // Sprint 21: TEST sağlayıcısı üretimde ASLA etkin olmaz (sahte ödeme sayfası / tamamlama sızamaz).
  const provider = env.PAYMENT_PROVIDER === "mock" && allowMock ? createMockProvider(webhookSecret()) : null;
  cached = { key, provider };
  return provider;
}

export function providerStatus(): { configured: boolean; name: string | null; test: boolean } {
  const p = getPaymentProvider();
  return { configured: !!p, name: p?.name ?? null, test: p?.test ?? false };
}
