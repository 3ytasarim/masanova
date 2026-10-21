import { describe, expect, it } from "vitest";
import { PLAN_ORDER, PLANS, planHasFeature, planIncludes } from "@/config/plans";
import { planCards } from "@/lib/marketing/plans";
import { enabledTools } from "@/lib/ai/tools";
import { buildRealtimeInstructions, enabledRealtimeTools } from "@/lib/ai/realtime-voice";
import { planSchema } from "@/lib/validation/tenant";

const settings = { allowRecommendations: true, allowCartActions: true, allowServiceActions: true };
const base = { restaurantName: "Küçük Kafe", assistantName: "Garson", tableName: "Masa 1", tone: "WARM" as const, currency: "TRY", catalog: "", customInstructions: null };

describe("Sesli Menü (Small) paketi", () => {
  it("menü + sesli asistan var; sipariş, mutfak, servis talebi yok", () => {
    expect(PLAN_ORDER).toEqual(["STARTER", "VOICE_MENU", "PRO", "AI"]);
    for (const f of ["qr_menu", "tables", "qr_labels", "branding", "voice_ai"] as const) expect(planHasFeature("VOICE_MENU", f)).toBe(true);
    for (const f of ["ordering", "kds", "service_requests", "business_advisor", "restaurant_payments"] as const) expect(planHasFeature("VOICE_MENU", f)).toBe(false);
    expect(PLANS.VOICE_MENU.limits.maxMonthlyAiMinutes).toBeGreaterThan(0);
    expect(planSchema.safeParse("VOICE_MENU").success).toBe(true);
  });

  it("sesli asistan: sepet / sipariş / garson çağırma araçları kapalı, menü bilgi araçları açık", () => {
    const tools = enabledRealtimeTools(settings, false, false);
    for (const t of ["addToCart", "updateCartItem", "reviewOrder", "placeOrder", "callService"]) expect(tools).not.toContain(t);
    for (const t of ["findMenuItems", "searchMenu", "getProductDetails", "getRecommendationCandidates", "getGuidance", "planMealByCalories"]) expect(tools).toContain(t);
    // Full (AI): hepsi açık
    expect(enabledRealtimeTools(settings, true, true)).toEqual(expect.arrayContaining(["addToCart", "placeOrder", "callService"]));
  });

  it("talimat: sipariş almaz, 'ekledim' demez, siparişi personele yönlendirir", () => {
    const text = buildRealtimeInstructions({ ...base, ordering: false, service: false });
    expect(text).toMatch(/BİLGİ ASİSTANI/);
    expect(text).toMatch(/garsonumuza \/ personele söyleyebileceğini/);
    expect(text).not.toMatch(/SİPARİŞ AKIŞI/);
    const full = buildRealtimeInstructions({ ...base, ordering: true, service: true });
    expect(full).toMatch(/SİPARİŞ AKIŞI/);
  });

  it("yazılı asistan da sepet / servis kartı üretmez", () => {
    const tools = enabledTools(settings, { ordering: false, service: false });
    for (const t of ["prepareCartAddition", "prepareCartChange", "openCartReview", "prepareServiceRequest"]) expect(tools).not.toContain(t);
    expect(enabledTools(settings)).toContain("prepareCartAddition");
  });

  it("paket kartları: Pro 'Sesli Menü'nün tamamı' demez (kapsamaz); AI hepsini kapsar", () => {
    expect(planIncludes("PRO", "VOICE_MENU")).toBe(false);
    expect(planIncludes("AI", "VOICE_MENU")).toBe(true);
    const cards = Object.fromEntries(planCards().map((c) => [c.plan, c]));
    expect(cards.VOICE_MENU!.includesPrevious).toBe("Starter");
    expect(cards.VOICE_MENU!.adds.join(" ")).toMatch(/Sesli AI/);
    expect(cards.PRO!.includesPrevious).toBe("Starter");
    expect(cards.AI!.includesPrevious).toBe("Pro");
  });
});
