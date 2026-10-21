import type { OrderStatus, ServiceRequestType } from "@prisma/client";
import type { CaloriePlanResult, Guidance } from "@/lib/ai/knowledge";

/**
 * Araç sonuçları (modele / kural tabanlı asistana giden müşteri-güvenli DTO). İç kimlik, kiracı / şube / masa, SKU,
 * maliyet YOK. Ürün anahtarı = menüdeki kısa ad (zaten public).
 */
type MenuItem = { key: string; name: string; category: string; priceLabel: string; soldOut: boolean; featured: boolean; dietaryTags: string[] };

export type ToolResult =
  | { tool: "searchMenu"; ok: true; items: MenuItem[]; total: number }
  | { tool: "getProductDetails"; ok: false; reason: "not_found" }
  | {
      tool: "getProductDetails";
      ok: true;
      product: {
        key: string;
        name: string;
        description: string | null;
        ingredients: string[];
        /** false → işletme alerjen bilgisi GİRMEMİŞ: "yok" çıkarımı yapılmaz. */
        allergenInfoDeclared: boolean;
        allergens: string[];
        dietaryTags: string[];
        spicy: boolean;
        soldOut: boolean;
        priceLabel: string;
        variants: { name: string; priceLabel: string }[];
        requiredChoices: string[];
      };
    }
  | { tool: "getProductAvailability"; ok: false; reason: "not_found" }
  | { tool: "getProductAvailability"; ok: true; name: string; soldOut: boolean; priceLabel: string }
  | { tool: "getProductPrice"; ok: false; reason: "not_found" }
  | { tool: "getProductPrice"; ok: true; name: string; priceLabel: string; variants: { name: string; priceLabel: string }[] }
  | {
      tool: "getRecommendationCandidates";
      ok: true;
      empty: boolean;
      items: { key: string; name: string; quantity: number; unitPriceLabel: string; lineTotalLabel: string }[];
      totalMinor: number;
      totalLabel: string;
      budgetMinor: number | null;
      budgetLabel: string | null;
      guests: number;
      fitsBudget: boolean;
      unmetDiets: string[];
      dietPicks: { tag: string; name: string }[];
    }
  | { tool: "getRecommendationCandidates"; ok: false; reason: "disabled" }
  | { tool: "getGuidance"; ok: true; guidance: Guidance }
  | { tool: "getGuidance"; ok: false; reason: "disabled" }
  | { tool: "planMealByCalories"; ok: true; result: CaloriePlanResult }
  | { tool: "planMealByCalories"; ok: false; reason: "disabled" }
  | { tool: "getCartSummary"; ok: true; lines: { name: string; quantity: number; lineTotalLabel: string; status: string }[]; totalLabel: string }
  | { tool: "getOrderStatus"; ok: true; orders: { number: string; status: OrderStatus }[] }
  | { tool: "prepareCartAddition"; ok: false; reason: "not_found" | "sold_out" | "disabled"; name?: string }
  | { tool: "prepareCartAddition"; ok: true; action: "configure"; name: string; reason: "required_modifiers" | "variant_choice"; requiredChoice: string | null }
  | { tool: "prepareCartAddition"; ok: true; action: "add"; name: string; quantity: number; totalLabel: string }
  | { tool: "prepareCartChange"; ok: false; reason: "not_in_cart" | "disabled" }
  | { tool: "prepareCartChange"; ok: true; name: string; quantity: number }
  | { tool: "prepareServiceRequest"; ok: false; reason: "disabled" }
  | { tool: "prepareServiceRequest"; ok: true; type: Exclude<ServiceRequestType, "CUSTOM">; alreadyActive: boolean }
  | { tool: "openCartReview"; ok: true; cartLines: number }
  | { tool: "openCartReview"; ok: false; reason: "disabled" }
  | { tool: string; ok: false; error: "invalid_arguments" | "unknown_tool" };
