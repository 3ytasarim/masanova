import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantScope } from "@/lib/tenant/scope";

/**
 * 4) A kiracısının bağlamı, repository katmanı üzerinden B kiracısının verisine erişemez.
 *
 * Bu birim testi Prisma'yı bellek içi bir sahte istemciyle değiştirir ve repository'lerin her sorguya
 * scope'tan gelen tenantId'yi eklediğini doğrular. Aynı senaryo gerçek PostgreSQL üzerinde
 * tests/integration/tenant-isolation.test.ts içinde de çalışır.
 */

type Row = { id: string; tenantId: string; name: string; slug: string; city: string | null; district: string | null; active: boolean };
type Where = Partial<Pick<Row, "id" | "tenantId" | "active">>;

const rows: Row[] = [];
const matches = (row: Row, where: Where = {}) =>
  Object.entries(where).every(([key, value]) => row[key as keyof Row] === value);

const fakeBranch = {
  findMany: vi.fn(async ({ where }: { where?: Where }) => rows.filter((r) => matches(r, where))),
  findFirst: vi.fn(async ({ where }: { where?: Where }) => rows.find((r) => matches(r, where)) ?? null),
  count: vi.fn(async ({ where }: { where?: Where }) => rows.filter((r) => matches(r, where)).length),
  updateMany: vi.fn(async ({ where, data }: { where?: Where; data: Partial<Row> }) => {
    const hit = rows.filter((r) => matches(r, where));
    hit.forEach((r) => Object.assign(r, data));
    return { count: hit.length };
  }),
};

vi.mock("@/lib/db/prisma", () => ({ prisma: { branch: fakeBranch } }));

const { countBranches, findBranchById, listBranches, setBranchActive } = await import("@/server/repositories/branch.repository");

describe("kiracı veri izolasyonu (repository)", () => {
  const scopeA = createTenantScope("tenant_a");

  beforeEach(() => {
    rows.length = 0;
    rows.push(
      { id: "branch_a1", tenantId: "tenant_a", name: "A Merkez", slug: "merkez", city: null, district: null, active: true },
      { id: "branch_b1", tenantId: "tenant_b", name: "B Merkez", slug: "merkez", city: null, district: null, active: true },
      { id: "branch_b2", tenantId: "tenant_b", name: "B Kadıköy", slug: "kadikoy", city: null, district: null, active: true },
    );
    vi.clearAllMocks();
  });

  it("listeleme yalnızca kendi kiracısının kayıtlarını döner", async () => {
    const list = await listBranches(scopeA);
    expect(list.map((b) => b.id)).toEqual(["branch_a1"]);
    expect(fakeBranch.findMany.mock.calls[0]?.[0].where).toMatchObject({ tenantId: "tenant_a" });
  });

  it("başka kiracının id'si ile tekil okuma null döner (IDOR)", async () => {
    await expect(findBranchById(scopeA, "branch_b1")).resolves.toBeNull();
    await expect(findBranchById(scopeA, "branch_a1")).resolves.toMatchObject({ id: "branch_a1" });
    for (const [args] of fakeBranch.findFirst.mock.calls) expect(args.where).toMatchObject({ tenantId: "tenant_a" });
  });

  it("başka kiracının kaydı güncellenemez ve değişmeden kalır", async () => {
    await expect(setBranchActive(scopeA, "branch_b1", false)).resolves.toBe(false);
    expect(rows.find((r) => r.id === "branch_b1")?.active).toBe(true);
    await expect(setBranchActive(scopeA, "branch_a1", false)).resolves.toBe(true);
  });

  it("sayım kiracıya kapsamlıdır", async () => {
    await expect(countBranches(scopeA)).resolves.toBe(1);
    await expect(countBranches(createTenantScope("tenant_b"))).resolves.toBe(2);
  });

  it("boş tenantId ile kapsam oluşturulamaz", () => {
    expect(() => createTenantScope("")).toThrow();
  });
});
