import type { NavItem } from "@/config/navigation";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Gezinmede yer alan ama henüz geliştirilmemiş bölümler için dürüst yer tutucu. */
export function ComingSoon({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader
        title={item.label}
        description={item.description}
        actions={item.sprint ? <Badge tone="accent">{item.sprint}</Badge> : undefined}
      />
      <EmptyState
        icon={item.icon}
        title="Bu modül yakında"
        description={`${item.label} modülü${item.sprint ? ` ${item.sprint} kapsamında` : ""} geliştirilecek. Altyapı (kiracı izolasyonu, yetkiler, denetim kaydı) hazır.`}
      />
    </>
  );
}
