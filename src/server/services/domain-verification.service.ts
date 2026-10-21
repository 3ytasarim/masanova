import "server-only";
import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { prisma } from "@/lib/db/prisma";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * Özel alan adı sahiplik doğrulaması — DNS TXT challenge.
 *
 *   Ad:    _masanova-verification.<hostname>
 *   Değer: masanova-verification=<token>
 *
 * Doğrulama YALNIZCA gerçek bir DNS sorgusunun beklenen değeri döndürmesiyle başarılı olur; aksi her durum
 * (kayıt yok, farklı değer, DNS hatası, zaman aşımı) FAILED olarak kaydedilir ve alan adı yayına çıkmaz.
 */

export const VERIFICATION_RECORD_LABEL = "_masanova-verification";
const VALUE_PREFIX = "masanova-verification=";

export function newVerificationToken(): string {
  return randomBytes(20).toString("hex");
}

export function verificationChallenge(hostname: string, token: string) {
  return { name: `${VERIFICATION_RECORD_LABEL}.${hostname}`, type: "TXT" as const, value: `${VALUE_PREFIX}${token}` };
}

export type VerificationOutcome = "VERIFIED" | "TXT_NOT_FOUND" | "TXT_MISMATCH" | "DNS_ERROR";

/** TXT kayıtları parçalar halinde gelebilir (255 bayt sınırı); her kayıt birleştirilip tam eşleşme aranır. */
export function evaluateTxtRecords(records: string[][], expectedValue: string): VerificationOutcome {
  const values = records.map((chunks) => chunks.join("").trim());
  if (values.some((v) => v === expectedValue)) return "VERIFIED";
  return values.some((v) => v.startsWith(VALUE_PREFIX)) ? "TXT_MISMATCH" : "TXT_NOT_FOUND";
}

export interface TxtResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

/** Varsayılan çözümleyici: Node DNS (sistem çözümleyicisi), 5 sn zaman aşımı, 2 deneme. */
export function createSystemTxtResolver(): TxtResolver {
  const resolver = new Resolver({ timeout: 5_000, tries: 2 });
  return { resolveTxt: (name) => resolver.resolveTxt(name) };
}

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export async function lookupChallenge(resolver: TxtResolver, hostname: string, token: string): Promise<VerificationOutcome> {
  const challenge = verificationChallenge(hostname, token);
  try {
    return evaluateTxtRecords(await resolver.resolveTxt(challenge.name), challenge.value);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return code && NOT_FOUND_CODES.has(code) ? "TXT_NOT_FOUND" : "DNS_ERROR";
  }
}

export const OUTCOME_LABELS: Record<Exclude<VerificationOutcome, "VERIFIED">, string> = {
  TXT_NOT_FOUND: "TXT kaydı bulunamadı. DNS değişikliklerinin yayılması birkaç dakikadan birkaç saate kadar sürebilir.",
  TXT_MISMATCH: "TXT kaydı bulundu ama değer eşleşmiyor. Değeri birebir kopyaladığınızdan emin olun.",
  DNS_ERROR: "DNS sorgusu tamamlanamadı (zaman aşımı veya sunucu hatası). Biraz sonra tekrar deneyin.",
};

/**
 * Kiracı kapsamlı doğrulama kontrolü. Sonuç (başarılı/başarısız) her durumda kaydedilir ve denetlenir.
 * Token denetim kaydına YAZILMAZ.
 */
export async function checkDomainVerification(
  actor: { userId: string },
  scope: TenantScope,
  domainId: string,
  meta: RequestMeta,
  resolver: TxtResolver = createSystemTxtResolver(),
): Promise<{ found: false } | { found: true; outcome: VerificationOutcome; hostname: string }> {
  const domain = await prisma.tenantDomain.findFirst({
    where: { id: domainId, tenantId: scope.tenantId, type: "CUSTOM_DOMAIN" },
    select: { id: true, hostname: true, verified: true, verification: { select: { id: true, token: true } } },
  });
  if (!domain || !domain.verification) return { found: false };
  if (domain.verified) return { found: true, outcome: "VERIFIED", hostname: domain.hostname };

  const outcome = await lookupChallenge(resolver, domain.hostname, domain.verification.token);
  const now = new Date();
  const verified = outcome === "VERIFIED";

  await prisma.$transaction(async (tx) => {
    await tx.domainVerification.update({
      where: { id: domain.verification!.id },
      data: {
        status: verified ? "VERIFIED" : "FAILED",
        failureReason: verified ? null : outcome,
        attempts: { increment: 1 },
        lastCheckedAt: now,
        ...(verified ? { verifiedAt: now } : {}),
      },
    });
    if (verified) {
      await tx.tenantDomain.updateMany({ where: { id: domain.id, tenantId: scope.tenantId }, data: { verified: true } });
    }
    await tx.auditLog.create({
      data: buildAuditRow(
        {
          action: verified ? "DOMAIN_VERIFIED" : "DOMAIN_VERIFICATION_FAILED",
          entity: "TenantDomain",
          entityId: domain.id,
          tenantId: scope.tenantId,
          userId: actor.userId,
          metadata: { hostname: domain.hostname, outcome },
        },
        meta,
      ),
    });
  });

  return { found: true, outcome, hostname: domain.hostname };
}
