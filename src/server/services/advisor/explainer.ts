import "server-only";
import { getServerEnv } from "@/lib/env";
import { ADVISOR_SYSTEM_PROMPT, parseExplanationArray, type ExplainItem } from "@/lib/advisor/prompt";
import { getProviders } from "@/server/services/ai/config";

/**
 * Danışman açıklayıcısı — MEVCUT AI sağlayıcı kaydını kullanır (ayrı bir AI yığını yok). Gerçek sağlayıcıda
 * `complete` ARAÇSIZ çağrılır: modelin çağırabileceği hiçbir araç yok → danışman hiçbir veriyi değiştiremez.
 * "mock" (geliştirme / test): deterministik açıklama üretir; ücretli istek yok.
 */
export type ExplainResult = { items: Record<string, unknown>[]; inputTokens: number; outputTokens: number };

export interface AdvisorExplainer {
  readonly name: string;
  readonly model: string;
  explain(items: ExplainItem[], signal?: AbortSignal): Promise<ExplainResult>;
}

const TIMEOUT_MS = 20_000;

function providerExplainer(): AdvisorExplainer | null {
  const ai = getProviders().ai;
  if (!ai) return null;
  return {
    name: ai.name,
    model: ai.model,
    async explain(items, signal) {
      const result = await ai.complete({
        system: ADVISOR_SYSTEM_PROMPT,
        history: [],
        utterance: JSON.stringify({ insights: items }),
        language: "tr",
        tools: [],
        executeTool: async () => {
          throw new Error("Danışman araç çalıştıramaz.");
        },
        signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
      });
      return { items: parseExplanationArray(result.text), inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    },
  };
}

/** Geliştirme / test: deterministik, olgulara sadık açıklama (yalnızca verilen sayılar). */
export const mockAdvisorExplainer: AdvisorExplainer = {
  name: "mock",
  model: "advisor-mock",
  async explain(items) {
    return {
      items: items.map((i) => ({
        id: i.id,
        summary: `${i.finding}`,
        whyItMatters: WHY_BY_CATEGORY[i.category] ?? "Bu değişim operasyonu izlerken dikkate alınabilir.",
        suggestedAction: `Değerlendirilebilir: ${i.allowedActions[0] ?? "eğilimi izlemek"}.`,
      })),
      inputTokens: 0,
      outputTokens: 0,
    };
  },
};

const WHY_BY_CATEGORY: Record<string, string> = {
  SALES: "Sipariş hacmi ve sepet içeriği, mutfak ve servis planlamasını doğrudan etkiler.",
  MENU: "Ürünlerin adet ve katkı dağılımı, menü kararlarına yardımcı olabilir.",
  OPERATIONS: "Bekleme süreleri misafir deneyiminin önemli bir parçasıdır.",
  KDS: "Mutfaktaki gecikmeler siparişin tamamının servis zamanını belirleyebilir.",
  SERVICE: "Taleplere yanıt süresi misafirin bekleme hissini etkiler.",
  TABLES: "Bölgeler arası farklar servis planlamasında dikkate alınabilir.",
  AI_USAGE: "AI asistanın sorunsuz çalışması misafir deneyimini destekler.",
};

let override: AdvisorExplainer | null | undefined;

/** Etkin açıklayıcı: AI_PROVIDER=mock → mock; yapılandırılmış sağlayıcı → o; yoksa null (deterministik şablonlar). */
export function getAdvisorExplainer(): AdvisorExplainer | null {
  if (override !== undefined) return override;
  if (getServerEnv().AI_PROVIDER === "mock") return mockAdvisorExplainer;
  return providerExplainer();
}

export function setAdvisorExplainerForTests(explainer: AdvisorExplainer | null | undefined): void {
  override = explainer;
}
