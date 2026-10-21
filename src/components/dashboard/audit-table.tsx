import { auditActionLabel } from "@/lib/audit/actions";
import { formatDateTime } from "@/lib/utils/format";
import type { AuditListItem } from "@/server/repositories/audit-log.repository";
import { summarizeMetadata } from "@/components/dashboard/audit-row";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

/** Denetim kayıtları tablosu (platform + kiracı sekmesi ortak). Aktör/kiracı adları toplu eşlemeyle gelir. */
export function AuditTable({
  logs,
  actors,
  tenants,
}: {
  logs: AuditListItem[];
  actors: Map<string, string>;
  tenants?: Map<string, string>;
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Zaman</TH>
          <TH>Eylem</TH>
          <TH>Varlık</TH>
          {tenants ? <TH>İşletme</TH> : null}
          <TH>Aktör</TH>
          <TH>Ayrıntı</TH>
          <TH>IP</TH>
        </TR>
      </THead>
      <TBody>
        {logs.map((log) => (
          <TR key={log.id}>
            <TD label="Zaman" className="whitespace-nowrap">{formatDateTime(log.createdAt)}</TD>
            <TD label="Eylem">
              <span className="block text-fg">{auditActionLabel(log.action)}</span>
              <code className="font-mono text-[0.6875rem] text-fg-subtle">{log.action}</code>
            </TD>
            <TD label="Varlık">
              {log.entity}
              {log.entityId ? <span className="ml-1.5 font-mono text-xs text-fg-subtle">{log.entityId.slice(0, 10)}</span> : null}
            </TD>
            {tenants ? <TD label="İşletme">{log.tenantId ? (tenants.get(log.tenantId) ?? log.tenantId.slice(0, 10)) : "—"}</TD> : null}
            <TD label="Aktör" className="break-all">{log.userId ? (actors.get(log.userId) ?? log.userId.slice(0, 10)) : "—"}</TD>
            <TD label="Ayrıntı" className="max-w-72 text-xs">{summarizeMetadata(log.metadata) || "—"}</TD>
            <TD label="IP" className="font-mono text-xs">{log.ipAddress ?? "—"}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
