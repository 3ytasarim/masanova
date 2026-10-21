import { describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { navigationMock, NotFoundSignal, RedirectSignal } from "../support/next-mocks";

/**
 * Sprint 11 — destek modu SALT OKUNUR taraması. Super Admin destek modundayken Sprint 0–10'daki TÜM panel eylemleri
 * (menü, tema, masalar, sipariş, mutfak / istasyon, servis, AI ayarları) çağrılır; hiçbiri veritabanına YAZAMAZ.
 * Veritabanı her modele / yönteme cevap veren kayıt tutucu bir vekille değiştirilir: okumalar boş döner, yazmalar kaydedilir.
 * Müşteri (QR) eylemleri oturum kullanmaz — destek modunun kapsamı dışındadır ve listede ayrıca belirtilir.
 */
const writes: string[] = [];
const WRITE = /^(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe)$/;

function model(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_t, method: string) {
        if (method === "then") return undefined;
        return async () => {
          if (WRITE.test(method)) {
            writes.push(`${name}.${method}`);
            return { count: 0 };
          }
          if (method === "count") return 0;
          if (method.startsWith("findMany") || method === "groupBy") return [];
          return null;
        };
      },
    },
  );
}
const prismaProxy: unknown = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === "then") return undefined;
      if (prop === "$transaction") return async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaProxy) : Promise.all(arg as unknown[]));
      if (prop === "$executeRaw" || prop === "$executeRawUnsafe") return async () => void writes.push(prop);
      if (prop === "$queryRaw" || prop === "$queryRawUnsafe") return async () => [];
      return model(prop);
    },
  },
);

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const session: CurrentSession = {
  id: "s",
  support: { tenantId: TENANT_A, startedAt: new Date() },
  user: { id: "u_admin", tenantId: null, email: "admin@x.y", firstName: "S", lastName: "A", role: "SUPER_ADMIN", active: true, tenant: null },
};

vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.0.0.1" })), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session.user), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaProxy }));
vi.mock("@/server/repositories/tenant-admin.repository", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })),
}));

/** Müşteri yüzü (oturumsuz, QR bağlamlı) — destek modu kapsamı dışında; ayrıca Super Admin / kimlik / pazarlama eylemleri. */
const NOT_PANEL = new Set([
  "submitOrderAction",
  "checkCartAction",
  "submitServiceRequestAction",
  "cancelServiceRequestAction",
  "listServiceRequestsAction",
  "listCustomerServiceRequestsAction",
]);

const PANEL_MODULES = {
  "ai.actions": () => import("@/server/actions/ai.actions"),
  "advisor.actions": () => import("@/server/actions/advisor.actions"),
  "crm.actions": () => import("@/server/actions/crm.actions"),
  "reservation.actions": () => import("@/server/actions/reservation.actions"),
  "campaign.actions": () => import("@/server/actions/campaign.actions"),
  "payment.actions": () => import("@/server/actions/payment.actions"),
  "menu.actions": () => import("@/server/actions/menu.actions"),
  "order.actions": () => import("@/server/actions/order.actions"),
  "public-menu.actions": () => import("@/server/actions/public-menu.actions"),
  "service-request.actions": () => import("@/server/actions/service-request.actions"),
  "station.actions": () => import("@/server/actions/station.actions"),
  "tables.actions": () => import("@/server/actions/tables.actions"),
} as const;

const ID = "cmidididididididididididid";
const form = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: "X", title: "X", price: "10", basePrice: "10", status: "READY", to: "ACKNOWLEDGED", enabled: "on", assistantName: "A", tone: "WARM" })) f.append(k, v);
  return f;
};

describe("destek modu salt okunur (Sprint 0–10 panel eylemleri)", () => {
  it("hiçbir panel eylemi destek modunda veritabanına yazamaz", async () => {
    const report: { action: string; outcome: string }[] = [];
    for (const [moduleName, load] of Object.entries(PANEL_MODULES)) {
      const mod = (await load()) as Record<string, unknown>;
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function" || NOT_PANEL.has(name)) continue;
        writes.length = 0;
        let outcome = "returned";
        // Olası imzalar: (id, prev, form), (prev, form), (id, value), (form)
        for (const args of [[ID, null, form()], [null, form()], [ID, "READY"], [form()]]) {
          try {
            await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
          } catch (error) {
            outcome = error instanceof NotFoundSignal ? "notFound" : error instanceof RedirectSignal ? `redirect:${error.to}` : `error:${error instanceof Error ? error.message.slice(0, 40) : "?"}`;
          }
        }
        report.push({ action: `${moduleName}.${name}`, outcome });
        expect({ action: `${moduleName}.${name}`, writes: [...writes] }).toEqual({ action: `${moduleName}.${name}`, writes: [] });
      }
    }
    // Kapsam: her modülden en az bir eylem denendi ve eylemlerin çoğu açıkça reddedildi (notFound)
    expect(report.length).toBeGreaterThan(30);
    const rejected = report.filter((r) => r.outcome === "notFound").length;
    expect(rejected / report.length).toBeGreaterThan(0.8);
    // Sprint 15: İşletme Danışmanı eylemleri (kapat / geri bildirim / ücretli yenileme) de reddedilir
    expect(report.filter((r) => r.action.startsWith("advisor.actions.")).every((r) => r.outcome === "notFound")).toBe(true);
    // Sprint 16: CRM / sadakat eylemleri (müşteri ekle / düzenle, izin geri al, puan düzelt, sadakat ayarı) reddedilir
    const crm = report.filter((r) => r.action.startsWith("crm.actions."));
    expect(crm.length).toBe(5);
    expect(crm.every((r) => r.outcome === "notFound")).toBe(true);
    // Sprint 17: rezervasyon eylemleri (oluşturma, walk-in, durum, masa, not, ayarlar) reddedilir
    const res = report.filter((r) => r.action.startsWith("reservation.actions."));
    expect(res.length).toBeGreaterThanOrEqual(11);
    expect(res.every((r) => r.outcome === "notFound")).toBe(true);
    // Sprint 18: kupon / ödül / kampanya eylemleri reddedilir
    const camp = report.filter((r) => r.action.startsWith("campaign.actions."));
    expect(camp.length).toBe(6);
    expect(camp.every((r) => r.outcome === "notFound")).toBe(true);
    // Sprint 19: manuel ödeme / iade / mutabakat / ödeme ayarları reddedilir
    const pay = report.filter((r) => r.action.startsWith("payment.actions."));
    expect(pay.length).toBe(4);
    expect(pay.every((r) => r.outcome === "notFound")).toBe(true);
  }, 30_000);
});
