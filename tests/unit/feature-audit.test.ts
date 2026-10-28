import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES, PLAN_ORDER, planHasFeature, type Feature } from "@/config/plans";

/**
 * Sprint 20 — OTOMATİK özellik denetimi. Her sunucu eylemi ve uç nokta açıkça sınıflandırılır:
 *   { gate: Feature, where: "action" | "<servis dosyası>" } → kaynakta kanonik kapı çağrısı OLMALI
 *   "continuation" → mevcut kaydı tamamlama / güvenlik / gizlilik (paket düşse de çalışır — bilinçli)
 *   "all_plans"    → her pakette olan özellik (QR menü, masa, menü, tema) ya da paket dışı (giriş, platform)
 * Yeni bir eylem / rota eklenip sınıflandırılmazsa bu test KIRILIR (kapısız uç nokta sızmaz).
 */
type Policy = { gate: Feature; where: "action" | string } | "continuation" | "all_plans";
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const A = (gate: Feature): Policy => ({ gate, where: "action" });
const S = (gate: Feature, where: string): Policy => ({ gate, where });

const ACTIONS: Record<string, Record<string, Policy>> = {
  "advisor.actions": { refreshAdvisorAction: S("business_advisor", "src/server/services/advisor/advisor.service.ts"), dismissInsightAction: S("business_advisor", "src/server/services/advisor/advisor.service.ts"), insightFeedbackAction: S("business_advisor", "src/server/services/advisor/advisor.service.ts") },
  "ai.actions": { saveAiSettingsAction: S("voice_ai", "src/server/services/ai/settings.service.ts") },
  "pairings.actions": { savePairingsAction: A("voice_ai"), generatePairingsAction: A("voice_ai") },
  "voice-index.actions": { buildVoiceIndexAction: A("voice_ai"), testVoiceMatchAction: A("voice_ai") },
  "auth.actions": { loginAction: "all_plans", logoutAction: "all_plans" },
  "campaign.actions": { saveCouponAction: A("promotions"), couponStatusAction: A("promotions"), saveRewardAction: A("promotions"), rewardStateAction: A("promotions"), saveCampaignAction: A("promotions"), campaignStatusAction: A("promotions") },
  "crm.actions": { createCustomerAction: A("crm"), updateCustomerAction: A("crm"), revokeConsentAction: "continuation", adjustPointsAction: A("loyalty"), saveLoyaltySettingsAction: A("loyalty") },
  "customer.actions": { joinCustomerAction: A("crm"), verifyCustomerAction: A("crm"), updateCustomerNameAction: "continuation", updateCustomerConsentsAction: "continuation", logoutCustomerAction: "continuation", requestCustomerDeletionAction: "continuation" },
  "demo-request.actions": { submitDemoRequestAction: "all_plans", updateDemoRequestAction: "all_plans" },
  "menu.actions": Object.fromEntries(["saveCategoryAction", "categoryQuickAction", "updateProductGeneralAction", "updateProductPricingAction", "updateProductContentAction", "saveProductTranslationsAction", "productImageAction", "productQuickAction", "bulkProductAction", "saveVariantAction", "variantQuickAction", "saveModifierGroupAction", "modifierGroupQuickAction", "saveModifierAction", "modifierQuickAction", "productModifierGroupAction", "saveLibraryItemAction", "saveBranchOverrideAction", "createProductAction"].map((n) => [n, "all_plans" as Policy])),
  "menu-translate.actions": { translateMenuStepAction: "all_plans" },
  "onboarding.actions": { checkSlugAvailabilityAction: "all_plans", checkDomainAvailabilityAction: "all_plans", checkOwnerEmailAction: "all_plans", createTenantAction: "all_plans" },
  "order.actions": { submitOrderAction: S("ordering", "src/server/services/orders/submit-order.service.ts"), checkCartAction: A("ordering"), orderStatusAction: "continuation", ticketStatusAction: "continuation" },
  "payment-public.actions": { startPaymentAction: S("restaurant_payments", "src/server/payments/payment.service.ts"), paymentStatusAction: "continuation", paymentsAvailableAction: S("restaurant_payments", "src/server/payments/payment.service.ts") },
  "payment.actions": { recordManualPaymentAction: S("restaurant_payments", "src/server/payments/payment.service.ts"), refundPaymentAction: "continuation", reconcilePaymentAction: "continuation", savePaymentSettingsAction: A("restaurant_payments") },
  "promotion-public.actions": { previewPromotionAction: A("promotions"), promotionOptionsAction: A("promotions") },
  "public-menu.actions": { savePublicThemeAction: "all_plans" },
  "reservation-public.actions": { reservationAvailabilityAction: S("reservations", "src/server/reservations/availability.service.ts"), createPublicReservationAction: S("reservations", "src/server/reservations/booking.service.ts"), cancelReservationByTokenAction: "continuation" },
  "reservation.actions": {
    createStaffReservationAction: A("reservations"),
    walkInAction: A("reservations"),
    reservationStatusAction: "continuation",
    reassignTablesAction: "continuation",
    reservationNoteAction: "continuation",
    saveReservationSettingsAction: A("reservations"),
    saveOpeningHoursAction: A("reservations"),
    addBlackoutAction: A("reservations"),
    deleteBlackoutAction: "continuation",
    createCombinationAction: A("reservations"),
    deleteCombinationAction: "continuation",
  },
  "service-request.actions": { submitServiceRequestAction: S("service_requests", "src/server/services/service-requests/customer-request.service.ts"), listServiceRequestsAction: "continuation", cancelOwnServiceRequestAction: "continuation", serviceRequestStaffAction: "continuation" },
  "knowledge.actions": { saveKnowledgeAction: "all_plans", deleteKnowledgeAction: "all_plans", testKnowledgeAction: "all_plans" },
  "staff.actions": { createStaffAction: "all_plans", updateStaffAction: "all_plans", resetStaffPasswordAction: "continuation", changeOwnPasswordAction: "continuation" },
  "settings.actions": { updateBusinessGeneralAction: "all_plans", createOwnBranchAction: "all_plans", updateOwnBranchAction: "all_plans" },
  "station.actions": { saveStationAction: A("preparation_stations"), stationQuickAction: A("preparation_stations"), saveProductStationsAction: A("preparation_stations") },
  "subscription-admin.actions": Object.fromEntries(["activateSubscriptionAction", "startTrialAction", "extendTrialAction", "setPeriodEndAction", "scheduleCancelAction", "setSubscriptionStatusAction", "setOverrideAction", "removeOverrideAction"].map((n) => [n, "all_plans" as Policy])),
  "tables.actions": Object.fromEntries(["saveAreaAction", "areaQuickAction", "createTableAction", "updateTableAction", "bulkCreateTablesAction", "tableQuickAction", "tableQrAction", "ensureTablesQrAction"].map((n) => [n, "all_plans" as Policy])),
  "tenant-admin.actions": Object.fromEntries(["updateTenantGeneralAction", "updateTenantBrandingAction", "changeTenantSlugAction", "changeTenantStatusAction", "changeTenantPlanAction", "createBranchAction", "updateBranchAction", "addCustomDomainAction", "domainOperationAction", "startSupportModeAction", "stopSupportModeAction", "invalidateTenantMenuCacheAction"].map((n) => [n, "all_plans" as Policy])),
};

const ROUTES: Record<string, Policy> = {
  "src/app/api/admin/metrics/route.ts": "all_plans",
  "src/app/api/health/route.ts": "all_plans",
  "src/app/api/ready/route.ts": "all_plans",
  "src/app/api/v1/media/route.ts": "all_plans",
  "src/app/api/v1/payments/webhook/[provider]/route.ts": "continuation",
  "src/app/api/v1/tenant/route.ts": "all_plans",
  "src/app/media/[...key]/route.ts": "all_plans",
  "src/app/panel/analitik/disa-aktar/route.ts": S("analytics", "src/app/panel/analitik/disa-aktar/route.ts"),
  "src/app/panel/masalar/indir/etiket/route.ts": "all_plans",
  "src/app/panel/masalar/indir/qr/route.ts": "all_plans",
  "src/app/panel/masalar/indir/sayfa/route.ts": "all_plans",
  "src/app/panel/olaylar/route.ts": "continuation",
  "src/app/site/platform/[...path]/route.ts": "all_plans",
  "src/app/site/t/[token]/akis/route.ts": "continuation",
  "src/app/site/t/[token]/asistan/canli/rapor/route.ts": S("voice_ai", "src/server/services/ai/access.service.ts"),
  "src/app/site/t/[token]/asistan/canli/route.ts": S("voice_ai", "src/server/services/ai/access.service.ts"),
  "src/app/site/t/[token]/asistan/oturum/route.ts": S("voice_ai", "src/server/services/ai/access.service.ts"),
  "src/app/site/t/[token]/asistan/route.ts": S("voice_ai", "src/server/services/ai/access.service.ts"),
  "src/app/site/t/[token]/asistan/ses/route.ts": S("voice_ai", "src/server/services/ai/access.service.ts"),
  "src/app/site/t/[token]/asistan/ses-oturum/route.ts": S("voice_ai", "src/server/services/ai/realtime-voice.service.ts"),
  "src/app/site/t/[token]/asistan/arac/route.ts": S("voice_ai", "src/server/services/ai/realtime-voice.service.ts"),
  "src/app/site/t/[token]/asistan/kayit/route.ts": S("voice_ai", "src/server/services/ai/realtime-voice.service.ts"),
  "src/app/site/t/[token]/siparis/[publicId]/akis/route.ts": "continuation",
};

/** Kaynakta kanonik kapı izi (paket karşılaştırması DEĞİL). */
const GATE = (feature: Feature) => new RegExp(`(featureDenied|checkFeature|requireFeature)\\([^)]*"${feature}"|\\.has\\("${feature}"\\)|voiceAiAvailability|ent\\.has\\("${feature}"\\)`);

function exportedBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export async function (\w+)\(/g;
  const starts = [...src.matchAll(re)].map((m) => ({ name: m[1]!, at: m.index! }));
  starts.forEach((s, i) => out.set(s.name, src.slice(s.at, starts[i + 1]?.at ?? src.length)));
  return out;
}

describe("özellik denetim matrisi", () => {
  it("her sunucu eylemi sınıflandırılmış (yeni kapısız eylem yakalanır)", () => {
    const dir = path.join(ROOT, "src/server/actions");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".actions.ts"));
    const unclassified: string[] = [];
    for (const file of files) {
      const mod = file.replace(/\.ts$/, "");
      const bodies = exportedBodies(read(`src/server/actions/${file}`));
      for (const name of bodies.keys()) if (!ACTIONS[mod]?.[name]) unclassified.push(`${mod}.${name}`);
    }
    expect(unclassified).toEqual([]);
  });

  it("kapılı eylemler kaynakta kanonik kapıyı çağırır (eylemde ya da servis katmanında)", () => {
    const missing: string[] = [];
    for (const [mod, fns] of Object.entries(ACTIONS)) {
      const bodies = exportedBodies(read(`src/server/actions/${mod}.ts`));
      for (const [name, policy] of Object.entries(fns)) {
        if (typeof policy === "string") continue;
        const src = policy.where === "action" ? (bodies.get(name) ?? "") : read(policy.where);
        if (!GATE(policy.gate).test(src)) missing.push(`${mod}.${name} → ${policy.gate}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("her rota sınıflandırılmış; kapılı rotalar kapıyı uygular", () => {
    const routes: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.name === "route.ts") routes.push(rel);
      }
    };
    walk("src/app");
    expect(routes.filter((r) => !ROUTES[r])).toEqual([]);
    for (const [route, policy] of Object.entries(ROUTES)) {
      if (typeof policy === "string") continue;
      expect(GATE(policy.gate).test(read(policy.where)), route).toBe(true);
    }
  });

  it("paket beklentisi: kapılı her özellik STARTER'da yok, AI'da var; PRO yalnızca AI özelliklerinden yoksun", () => {
    const gated = new Set<Feature>();
    for (const fns of Object.values(ACTIONS)) for (const p of Object.values(fns)) if (typeof p !== "string") gated.add(p.gate);
    for (const f of gated) {
      expect(planHasFeature("STARTER", f), f).toBe(false);
      expect(planHasFeature("AI", f), f).toBe(true);
      expect(planHasFeature("PRO", f), f).toBe(f !== "voice_ai" && f !== "business_advisor");
    }
    expect(PLAN_ORDER).toEqual(["STARTER", "VOICE_MENU", "PRO", "AI"]);
    // Kanonik çözücü dışında paket karşılaştırması yazılmaz
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(e.name) && read(rel).split("\n").some((l) => !/^\s*(\*|\/\/)/.test(l) && /plan === "(PRO|AI|STARTER)"|\.plan\s*===\s*"/.test(l))) offenders.push(rel);
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
    expect(FEATURES.length).toBe(16);
  });
});
