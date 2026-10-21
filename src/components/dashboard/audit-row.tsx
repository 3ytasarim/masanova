import { auditActionLabel } from "@/lib/audit/actions";
import { formatDateTime } from "@/lib/utils/format";
import type { AuditListItem } from "@/server/repositories/audit-log.repository";

/** Denetim metadata'sının kısa, okunabilir özeti (tablo hücresi / zaman akışı için). */
export function summarizeMetadata(metadata: AuditListItem["metadata"]): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const entries = Object.entries(metadata)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return entries.join(" · ");
}

/** Gösterge paneli / sekmelerdeki kompakt denetim satırı. */
export function AuditTimelineItem({ log, actor }: { log: AuditListItem; actor?: string }) {
  const summary = summarizeMetadata(log.metadata);
  return (
    <li className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{auditActionLabel(log.action)}</div>
        <div className="truncate text-xs text-fg-subtle">{[actor, summary].filter(Boolean).join(" · ") || log.entity}</div>
      </div>
      <time dateTime={log.createdAt.toISOString()} className="shrink-0 text-xs text-fg-subtle">
        {formatDateTime(log.createdAt)}
      </time>
    </li>
  );
}
