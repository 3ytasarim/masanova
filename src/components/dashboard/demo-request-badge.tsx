import type { DemoRequestStatus } from "@prisma/client";
import { Badge, type BadgeTone } from "@/components/ui/badge";

export const DEMO_STATUS: Record<DemoRequestStatus, { label: string; tone: BadgeTone }> = {
  NEW: { label: "Yeni", tone: "accent" },
  CONTACTED: { label: "İletişime geçildi", tone: "info" },
  QUALIFIED: { label: "Nitelikli", tone: "warning" },
  WON: { label: "Kazanıldı", tone: "success" },
  LOST: { label: "Kaybedildi", tone: "neutral" },
};

export function DemoRequestBadge({ status }: { status: DemoRequestStatus }) {
  return (
    <Badge tone={DEMO_STATUS[status].tone} dot>
      {DEMO_STATUS[status].label}
    </Badge>
  );
}
