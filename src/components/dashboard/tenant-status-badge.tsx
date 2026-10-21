import type { TenantStatus } from "@prisma/client";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const STATUS: Record<TenantStatus, { label: string; tone: BadgeTone }> = {
  TRIAL: { label: "Deneme", tone: "info" },
  ACTIVE: { label: "Aktif", tone: "success" },
  SUSPENDED: { label: "Askıda", tone: "warning" },
  CANCELLED: { label: "İptal", tone: "neutral" },
};

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}
