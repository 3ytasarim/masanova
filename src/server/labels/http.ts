import "server-only";
import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/auth/guards";
import { getRequestMeta } from "@/lib/security/request-meta";
import { slugify } from "@/lib/utils/slugify";
import type { TablesActor } from "@/server/services/tables/tables-common";

/**
 * QR / etiket indirme uçlarının ortak parçaları. Token'lı adres içeren her çıktı yalnızca masa YÖNETİM yetkisiyle
 * üretilir (write: true → Super Admin destek modunda QR görüntülenmez/indirilemez); yanıtlar önbelleğe alınmaz.
 */
export async function downloadActor(): Promise<TablesActor> {
  const ctx = await requireTenantUser({ permission: "tables.manage", write: true });
  return { userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() };
}

export function fileName(base: string, ext: string): string {
  return `${slugify(base, 60) || "masa"}.${ext}`;
}

export function fileResponse(body: BodyInit, contentType: string, name: string, inline = false, extraHeaders: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
