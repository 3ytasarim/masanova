import type { Metadata } from "next";
import { Eye, Info } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/utils/format";
import { tenantHasFeature } from "@/server/services/ai/access.service";
import { getVoiceIndexView, refreshVoiceIndexIfStale } from "@/server/services/ai/voice-index.service";
import { VoiceMenuTraining } from "@/components/ai/voice-menu-training";

export const metadata: Metadata = { title: "Menü Eğitimi · AI" };
export const dynamic = "force-dynamic";

/**
 * Sesli menü eğitimi — ai.manage (sahip / müdür). Menü otomatik taranır; işletme telaffuz / takma ad girmez. Belirsiz
 * isimler yalnızca çakışma ya da genel adlar için listelenir. Destek modu salt okunur.
 */
export default async function VoiceMenuTrainingPage() {
  const ctx = await requireTenantUser({ permission: "ai.manage" });
  const featureAvailable = await tenantHasFeature(ctx.scope, "voice_ai");
  const view = featureAvailable ? await getVoiceIndexView(ctx.scope) : null;
  // Menü değiştiyse arka planda yeniden kurulur (sayfa beklemez).
  if (view?.status === "STALE" && !ctx.support) refreshVoiceIndexIfStale(ctx.scope);

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Menü Eğitimi</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">
          Sesli garson, menünüzdeki ürünleri müşterinin söylediği gibi tanır (“fetuçini alfredo”, “çizburger”, “iki büyük ayran”). Emin olamadığında sorar; menüde olmayan bir ürünü asla uydurmaz.
        </p>
        {ctx.support ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Destek modu — salt okunur.
          </p>
        ) : null}
      </header>
      {view ? (
        <VoiceMenuTraining
          readOnly={!!ctx.support}
          state={{ status: view.status, builtAtLabel: view.builtAt ? formatDateTime(view.builtAt) : null, counts: view.counts, ambiguities: view.ambiguities, aiAugmented: view.aiAugmented }}
        />
      ) : (
        <p role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="ai-plan-notice">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Voice AI mevcut paketinizde aktif değil.
        </p>
      )}
    </>
  );
}
