import type { Metadata } from "next";
import { Eye, Info, Lightbulb, ShieldCheck } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { advisorUsage, loadAdvisor, parseRange } from "@/server/services/advisor/advisor.service";
import { RefreshButton } from "@/components/advisor/advisor-controls";
import { InsightCard } from "@/components/advisor/insight-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "İşletme Danışmanı" };
export const dynamic = "force-dynamic";

const RANGE_LABELS = { today: "Bugün", last7: "Son 7 gün", last30: "Son 30 gün" } as const;
const BRIEF_TITLES = { today: "Günün Özeti", last7: "Haftalık Özet", last30: "Aylık Özet" } as const;

/**
 * İşletme Danışmanı — advisor.view (sahip / müdür). Salt okunur: içgörüler önerir, hiçbir ayarı / fiyatı / menüyü
 * değiştirmez. Destek modunda kayıt yazılmaz (görüntüleme). Paket kapısı (business_advisor) sunucuda uygulanır.
 */
export default async function AdvisorPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireTenantUser({ permission: "advisor.view" });
  const sp = await searchParams;
  const range = parseRange(param(sp, "aralik", 10));
  const branch = param(sp, "sube", 40) ?? null;
  const support = !!ctx.support;
  const canManage = !support && hasPermission(ctx.user.role, "advisor.manage");
  const result = await loadAdvisor({ scope: ctx.scope, userId: ctx.user.id, canMutate: canManage }, { range, branch });

  const header = (
    <header className="pb-6">
      <h1 className="text-title font-semibold text-fg">İşletme Danışmanı</h1>
      <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">
        Sipariş, mutfak, servis ve menü verilerinizde neyin değiştiğini, nedenini nasıl hesapladığımızı ve neyi gözden geçirebileceğinizi gösterir. Danışman yalnızca önerir; hiçbir ayarı, fiyatı ya da menüyü kendisi değiştirmez.
      </p>
      {support ? (
        <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
          <Eye aria-hidden="true" className="size-4" /> Destek modu — salt okunur.
        </p>
      ) : null}
    </header>
  );

  if (!result.ok && result.error === "feature") {
    return (
      <>
        {header}
        <Card data-testid="advisor-locked">
          <CardContent className="py-8">
            <EmptyState icon={Lightbulb} title="İşletme Danışmanı AI paketinde" description="Paketiniz yükseltildiğinde içgörüler burada görünür. Paket değişikliği için bizimle iletişime geçin." />
          </CardContent>
        </Card>
      </>
    );
  }
  if (!result.ok) {
    return (
      <>
        {header}
        <p role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger" data-testid="advisor-error">
          {result.error === "branch_invalid" ? "Şube bulunamadı." : "Geçersiz tarih aralığı."}
        </p>
      </>
    );
  }

  const view = result.view;
  const usage = canManage ? await advisorUsage(ctx.scope.tenantId, new Date(view.generatedAt.getTime() - 30 * 86_400_000)) : null;
  const rest = view.cards.slice(view.highlights.length);

  return (
    <>
      {header}
      <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between" data-testid="advisor-page" data-range={view.range} data-branch={view.branchId ?? ""}>
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Danışman filtresi">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-fg">Dönem</span>
            <select name="aralik" defaultValue={view.range} data-testid="advisor-range" className="h-11 min-w-36 rounded-md border border-border-strong bg-bg px-3">
              {Object.entries(RANGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-fg">Şube</span>
            <select name="sube" defaultValue={view.branchId ?? ""} data-testid="advisor-branch" className="h-11 min-w-40 rounded-md border border-border-strong bg-bg px-3">
              <option value="">Tüm şubeler</option>
              {view.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary" data-testid="advisor-apply">
            Uygula
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-fg-subtle">
            Kapsam: <span className="font-medium text-fg-muted">{view.branchName ?? "Tüm şubeler"}</span> · {view.period.current} · Karşılaştırma: {view.period.previous}
          </p>
          {canManage ? <RefreshButton range={view.range} branch={view.branchId ?? ""} /> : null}
        </div>
      </div>

      {view.cards.length === 0 ? (
        <Card data-testid="advisor-empty">
          <CardContent className="py-8">
            <EmptyState icon={ShieldCheck} title="Öne çıkan bir değişim yok" description="Bu dönemde belirgin ve yeterli veriyle desteklenen bir değişim bulunmadı. Az veriyle güçlü sonuç üretmemek için eşikler bilinçli olarak yüksek tutulur." />
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-labelledby="brief-title" className="mb-6 rounded-lg border border-border bg-bg p-5" data-testid="advisor-brief">
            <h2 id="brief-title" className="text-sm font-semibold uppercase tracking-wider text-fg-subtle">
              {BRIEF_TITLES[view.range]}
            </h2>
            <ul className="mt-3 grid gap-1.5 text-sm">
              {view.brief.map((b) => (
                <li key={b} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="highlights-title" data-testid="advisor-highlights">
            <h2 id="highlights-title" className="mb-3 text-lg font-semibold">
              {view.range === "today" ? "Bugün öne çıkanlar" : "Bu dönem öne çıkanlar"}
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {view.highlights.map((c) => (
                <InsightCard key={`${c.type}-${c.subjectKey}`} card={c} period={view.period} canManage={canManage} />
              ))}
            </div>
          </section>

          {rest.length ? (
            <section aria-labelledby="more-title" className="mt-8">
              <h2 id="more-title" className="mb-3 text-lg font-semibold">
                Diğer içgörüler
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {rest.map((c) => (
                  <InsightCard key={`${c.type}-${c.subjectKey}`} card={c} period={view.period} canManage={canManage} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info aria-hidden="true" className="size-4" /> Danışman nasıl çalışır?
          </CardTitle>
          <CardDescription>İçgörüleri kurallar bulur; AI yalnızca açıklar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-fg-muted">
          <p>1. Seçilen dönem, önceki eşdeğer dönemle karşılaştırılır (süren dönemde aynı geçen süre). Hafta içi / hafta sonu farkı ayrıca modellenmez.</p>
          <p>2. Yeterli veri yoksa (ör. birkaç sipariş) içgörü üretilmez; veri kalitesi etiketi örneklem büyüklüğüne göre hesaplanır.</p>
          <p>3. AI açıklaması yalnızca hesaplanan rakamları kullanabilir; kâr / marj, personel değerlendirmesi ya da neden-sonuç iddiası içeren açıklamalar reddedilir.</p>
          <p>4. Müşteri konuşmaları, kimlik ya da iletişim bilgisi kullanılmaz; yalnızca toplu operasyon verileri.</p>
          {usage ? (
            <p className="text-xs text-fg-subtle" data-testid="advisor-usage">
              Son 30 gün AI açıklama isteği: {usage.requests} (sesli asistan kullanımından ayrı sayılır).
            </p>
          ) : null}
          {!view.explainerAvailable ? <p className="text-xs text-fg-subtle">AI açıklaması şu an kullanılamıyor; içgörüler hesaplanan verilerle gösteriliyor.</p> : null}
        </CardContent>
      </Card>
    </>
  );
}
