import type { DomainType, DomainVerificationStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

export function DomainTypeBadge({ type }: { type: DomainType }) {
  return type === "SUBDOMAIN" ? <Badge>Alt alan</Badge> : <Badge tone="info">Özel alan</Badge>;
}

/** Yayın durumu: yalnızca `verified` alanı (gerçek DNS kontrolüyle set edilir) belirleyicidir. */
export function DomainStateBadge({ verified, status }: { verified: boolean; status?: DomainVerificationStatus | null }) {
  if (verified) return <Badge tone="success" dot>Doğrulandı · yayında</Badge>;
  if (status === "FAILED") return <Badge tone="danger" dot>Doğrulama başarısız</Badge>;
  return <Badge tone="warning" dot>DNS doğrulaması bekliyor</Badge>;
}
