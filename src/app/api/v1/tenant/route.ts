import { NextResponse } from "next/server";
import { toApiErrorResponse } from "@/lib/security/api-response";
import { requireTenant } from "@/lib/tenant/tenant-context";
import { listBranches } from "@/server/repositories/branch.repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tenant — isteğin geldiği alan adının public kiracı bilgisi (gelecekte QR menü istemcisi kullanır).
 * Kiracı kimliği yalnızca Host başlığından çözümlenir; sorgu parametresi / gövde ile kiracı SEÇİLEMEZ.
 *   404 TENANT_NOT_FOUND   → bilinmeyen / doğrulanmamış alan adı veya platform alan adı
 *   403 TENANT_UNAVAILABLE → askıya alınmış / iptal edilmiş işletme
 */
export async function GET() {
  try {
    const { tenant, scope } = await requireTenant();
    const branches = await listBranches(scope, { activeOnly: true });

    return NextResponse.json(
      {
        tenant: { name: tenant.name, slug: tenant.slug },
        branches: branches.map(({ name, slug, city, district }) => ({ name, slug, city, district })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
