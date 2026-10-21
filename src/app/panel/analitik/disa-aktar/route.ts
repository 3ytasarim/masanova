import { requireTenantUser } from "@/lib/auth/guards";
import { getRequestId } from "@/lib/security/request-meta";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { csvFileName, csvStream, CSV_EXPORTS, type CsvExport } from "@/server/analytics/csv.service";
import { resolveAnalyticsContext } from "@/server/analytics/filter";
import { checkFeature } from "@/server/billing/entitlements";

/**
 * Analitik CSV dışa aktarımı — GET /panel/analitik/disa-aktar?tur=orders|products|service|kds&aralik=…&sube=…
 * Yetki: analytics.export (sahip / şube müdürü). Super Admin destek modunda DIŞA AKTARIM YOK (write: true → 404).
 * Kiracı oturumdan; şube yalnızca bu kiracının şubesi; aralık ≤ 366 gün; satır ≤ 50.000.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { scope } = await requireTenantUser({ permission: "analytics.export", write: true });
  if (!(await checkFeature(scope.tenantId, "analytics")).allowed) return new Response("feature_disabled", { status: 403, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const kind = url.searchParams.get("tur");
  if (!kind || !(CSV_EXPORTS as readonly string[]).includes(kind)) return new Response("Geçersiz dışa aktarım türü.", { status: 400, headers: { "Cache-Control": "no-store" } });
  const resolved = await resolveAnalyticsContext(scope, { range: url.searchParams.get("aralik"), from: url.searchParams.get("bas"), to: url.searchParams.get("bit"), branch: url.searchParams.get("sube") });
  if (!resolved.ok) return new Response(resolved.error === "branch_invalid" ? "Şube bulunamadı." : "Geçersiz tarih aralığı (en fazla 366 gün).", { status: resolved.error === "branch_invalid" ? 404 : 400, headers: { "Cache-Control": "no-store" } });
  metrics.inc("analytics.exports", 1, kind);
  log.info("analytics.export", { requestId: await getRequestId(), tenant: scope.tenantId, kind, days: Math.round((resolved.context.range.end.getTime() - resolved.context.range.start.getTime()) / 86_400_000) });
  return new Response(csvStream(kind as CsvExport, resolved.context), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(kind as CsvExport, resolved.context)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
