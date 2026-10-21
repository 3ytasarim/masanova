import type { TenantStatus } from "@prisma/client";
import { STATUS_LABELS, STATUS_TRANSITIONS, TRANSITION_COPY } from "@/lib/tenant/status";
import { changeTenantStatusAction } from "@/server/actions/tenant-admin.actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/**
 * Bir kiracı için izinli durum geçişlerinin onaylı düğmeleri. Yalnızca durum makinesinin izin verdiği
 * hedefler gösterilir; sunucu aynı kuralı ayrıca uygular.
 */
export function TenantStatusActions({ tenant, size = "sm" }: { tenant: { id: string; name: string; status: TenantStatus }; size?: "sm" | "md" }) {
  const targets = STATUS_TRANSITIONS[tenant.status];
  if (targets.length === 0) return null;
  const action = changeTenantStatusAction.bind(null, tenant.id);

  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((to) => {
        const copy = TRANSITION_COPY[to];
        const reasonId = `reason-${tenant.id}-${to}`;
        return (
          <ConfirmDialog
            key={to}
            action={action}
            hidden={{ to, from: tenant.status }}
            triggerLabel={copy.action}
            triggerVariant={copy.destructive ? "secondary" : "primary"}
            triggerSize={size}
            title={`${tenant.name}: ${STATUS_LABELS[tenant.status]} → ${STATUS_LABELS[to]}`}
            description={copy.confirm}
            confirmLabel={copy.action}
            destructive={copy.destructive}
          >
            {copy.destructive ? (
              <Field id={reasonId} label="Gerekçe" hint="İsteğe bağlı; denetim kaydına yazılır.">
                <Textarea id={reasonId} name="reason" rows={2} maxLength={500} aria-describedby={`${reasonId}-hint`} />
              </Field>
            ) : null}
          </ConfirmDialog>
        );
      })}
    </div>
  );
}
