import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveTenantByHost } from "@/lib/tenant/resolve-tenant";
import { createTenantScope } from "@/lib/tenant/scope";
import { countBranches, findBranchById, listBranches, setBranchActive } from "@/server/repositories/branch.repository";
import { tenantDomainLookup } from "@/server/repositories/tenant-domain.repository";

/**
 * Gerçek PostgreSQL üzerinde kiracı çözümleme + izolasyon. Benzersiz önekli geçici kiracılar oluşturur ve siler.
 *   npm run test:integration
 */
const run = randomBytes(4).toString("hex");
const root = "itest.localhost";

let tenantA: { id: string; branchId: string };
let tenantB: { id: string; branchId: string };

async function createTenant(label: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `İzolasyon ${label} ${run}`,
      slug: `itest-${label}-${run}`,
      status,
      domains: { create: { hostname: `${label}-${run}.${root}`, type: "SUBDOMAIN", verified: true, isPrimary: true } },
      branches: { create: { name: `${label} Merkez`, slug: "merkez" } },
    },
    select: { id: true, branches: { select: { id: true } } },
  });
  return { id: tenant.id, branchId: tenant.branches[0]!.id };
}

beforeAll(async () => {
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  await createTenant("s", "SUSPENDED");
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { endsWith: `-${run}` } } });
  await prisma.$disconnect();
});

describe("kiracı çözümleme (gerçek veritabanı)", () => {
  const deps = { lookup: tenantDomainLookup, rootHostname: root };

  it("bilinen host doğru kiracıya çözümlenir", async () => {
    const result = await resolveTenantByHost(`B-${run}.${root}:3000`, deps);
    expect(result).toMatchObject({ kind: "tenant", tenant: { id: tenantB.id } });
  });

  it("bilinmeyen host çözümlenmez", async () => {
    await expect(resolveTenantByHost(`yok-${run}.${root}`, deps)).resolves.toMatchObject({ kind: "not_found", reason: "unknown_host" });
  });

  it("askıdaki kiracı normal erişim almaz", async () => {
    await expect(resolveTenantByHost(`s-${run}.${root}`, deps)).resolves.toMatchObject({ kind: "unavailable" });
  });
});

describe("kiracı veri izolasyonu (gerçek veritabanı)", () => {
  it("A bağlamı B'nin şubesini okuyamaz", async () => {
    const scopeA = createTenantScope(tenantA.id);
    await expect(findBranchById(scopeA, tenantB.branchId)).resolves.toBeNull();
    await expect(findBranchById(scopeA, tenantA.branchId)).resolves.toMatchObject({ id: tenantA.branchId });
  });

  it("A bağlamının listesi ve sayımı B'yi içermez", async () => {
    const scopeA = createTenantScope(tenantA.id);
    const ids = (await listBranches(scopeA)).map((b) => b.id);
    expect(ids).toEqual([tenantA.branchId]);
    await expect(countBranches(scopeA)).resolves.toBe(1);
  });

  it("A bağlamı B'nin şubesini güncelleyemez", async () => {
    const scopeA = createTenantScope(tenantA.id);
    await expect(setBranchActive(scopeA, tenantB.branchId, false)).resolves.toBe(false);
    const untouched = await prisma.branch.findUniqueOrThrow({ where: { id: tenantB.branchId }, select: { active: true } });
    expect(untouched.active).toBe(true);
  });
});
