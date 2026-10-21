import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 9 güvenlik — AI ayarları yalnızca ai.manage + yazma (sahip / müdür); destek modu değiştiremez.
 * Sağlayıcı anahtarları tarayıcı koduna ulaşamaz (statik denetim).
 */
let session: CurrentSession | null = null;
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({
  findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })),
}));
const save = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true, data: undefined }));
vi.mock("@/server/services/ai/settings.service", () => ({ saveAiSettings: save }));

const { saveAiSettingsAction } = await import("@/server/actions/ai.actions");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
function makeSession(role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
}
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ enabled: "on", assistantName: "Asistan", tone: "WARM", allowRecommendations: "on", voiceEnabled: "on", ...extra })) f.append(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
});

describe("S9 güvenlik — AI ayarları", () => {
  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s AI ayarlarını değiştiremez", async (role) => {
    session = makeSession(role);
    await expect(saveAiSettingsAction(null, form())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(save).not.toHaveBeenCalled();
  });

  it("destek modu değiştiremez (salt okunur)", async () => {
    session = makeSession("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(saveAiSettingsAction(null, form())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(save).not.toHaveBeenCalled();
  });

  it("sahip / müdür kaydeder; kapsam oturumdan; formdaki kiracı / anahtar alanları yok sayılır", async () => {
    session = makeSession("BRANCH_MANAGER");
    await saveAiSettingsAction(null, form({ tenantId: "cmbbbbbbbbbbbbbbbbbbbbbbb", apiKey: "sk-secret", customInstructions: "Tatlıları sonra öner." }));
    const [actor, input] = save.mock.calls[0]! as [{ scope: { tenantId: string } }, Record<string, unknown>];
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(input).not.toHaveProperty("apiKey");
    expect(input).not.toHaveProperty("tenantId");
    expect(input).toMatchObject({ enabled: true, assistantName: "Asistan", customInstructions: "Tatlıları sonra öner." });
  });

  it("geçersiz değerler reddedilir (uzun not, bilinmeyen ton / dil)", async () => {
    session = makeSession("TENANT_OWNER");
    expect(await saveAiSettingsAction(null, form({ customInstructions: "x".repeat(301) }))).toMatchObject({ ok: false });
    expect(await saveAiSettingsAction(null, form({ tone: "RUDE" }))).toMatchObject({ ok: false });
    expect(await saveAiSettingsAction(null, form({ defaultVoiceLanguage: "fr" }))).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("S9 güvenlik — sağlayıcı anahtarları tarayıcıya gitmez", () => {
  const root = path.resolve(import.meta.dirname, "../../src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(root);

  it("istemci bileşenleri sunucu yapılandırmasını / anahtarları içe aktarmaz", () => {
    const clientFiles = files.filter((f) => /^["']use client["']/.test(readFileSync(f, "utf8").trimStart()));
    expect(clientFiles.length).toBeGreaterThan(10);
    for (const f of clientFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/AI_API_KEY|VOICE_(STT|TTS)_API_KEY|@\/lib\/env["']|services\/ai\/config|providers\/openai/);
    }
    // Tüm kaynak ağacını okur: paralel koşuda 5 sn varsayılanı aşabilir.
  }, 20_000);

  it("sağlayıcı / yapılandırma modülleri server-only", () => {
    for (const rel of ["server/services/ai/config.ts", "server/services/ai/providers/openai.ts", "server/services/ai/providers/mock.ts", "lib/env.ts", "server/services/ai/assistant.service.ts"]) {
      expect(readFileSync(path.join(root, rel), "utf8"), rel).toMatch(/^import "server-only";/);
    }
  });
});
