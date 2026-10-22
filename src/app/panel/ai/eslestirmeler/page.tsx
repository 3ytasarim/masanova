import type { Metadata } from "next";
import { Eye, Info } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { pairingViews, pairingsToText, readStoredPairings } from "@/lib/ai/pairings";
import { generatePairingsAction, savePairingsAction } from "@/server/actions/pairings.actions";
import { getAiSettings, tenantHasFeature } from "@/server/services/ai/access.service";
import { loadIndexProducts } from "@/server/services/ai/voice-index.service";
import { PairingsEditor } from "@/components/ai/pairings-editor";

export const metadata: Metadata = { title: "Eşleştirmeler · AI" };
export const dynamic = "force-dynamic";

/**
 * Yemek eşleştirmeleri — ai.manage (sahip / müdür), voice_ai paketi. Garson "yanına ne gider?" sorularında önce bunu
 * söyler (getPairings). Menüde olmayan ürün saklanmaz; silinen / tükenen ürün otomatik düşer. Destek modu salt okunur.
 */
export default async function PairingsPage() {
  const ctx = await requireTenantUser({ permission: "ai.manage" });
  const available = await tenantHasFeature(ctx.scope, "voice_ai");
  const [settings, products] = available ? await Promise.all([getAiSettings(ctx.scope.tenantId), loadIndexProducts(ctx.scope)]) : [null, []];
  const views = settings ? pairingViews(readStoredPairings(settings.pairings), products) : [];

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Eşleştirmeler</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">
          Hangi yemeğin yanına hangi meze ve içeceği önerdiğinizi yazın. Müşteri “balığın yanına hangi meze gider?” ya da “levreğin yanına ne içilir?” diye sorduğunda sesli garson önce sizin önerinizi söyler.
        </p>
        {ctx.support ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Destek modu — salt okunur.
          </p>
        ) : null}
      </header>
      {available ? (
        <PairingsEditor action={savePairingsAction} generate={generatePairingsAction} initialText={pairingsToText(views)} initialViews={views} readOnly={!!ctx.support} />
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-fg-muted">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Eşleştirmeler sesli AI asistanla birlikte kullanılır; paketinizde sesli AI yok.
        </p>
      )}
    </>
  );
}
