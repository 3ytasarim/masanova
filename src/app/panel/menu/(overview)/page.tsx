import { CircleSlash, FolderTree, ImageOff, Languages, Package, PackageCheck, Plus } from "lucide-react";
import Link from "next/link";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { getMenuOverview } from "@/server/repositories/menu.repository";
import { getMenuPageContext } from "@/server/menu-page-context";
import { translateMenuStepAction } from "@/server/actions/menu-translate.actions";
import { getJsonCompleter } from "@/server/services/ai/config";
import { countMissing, findMissingTranslations } from "@/server/services/menu/auto-translate.service";
import { AutoTranslateCard } from "@/components/menu/auto-translate-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";

export default async function MenuOverviewPage() {
  const { scope, canManage, locales } = await getMenuPageContext();
  const aiTranslate = !!getJsonCompleter() && locales.translatable.length > 0;
  const [overview, missing] = await Promise.all([getMenuOverview(scope, locales.translatable), aiTranslate ? findMissingTranslations(scope.tenantId, locales.translatable).then(countMissing) : 0]);

  return (
    <>
      {canManage ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <Link href="/panel/menu/urunler/yeni" className={buttonVariants({ size: "sm" })}>
            <Plus aria-hidden="true" /> Yeni Ürün
          </Link>
          <Link href="/panel/menu/kategoriler?yeni=1" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Plus aria-hidden="true" /> Yeni Kategori
          </Link>
        </div>
      ) : null}

      <section aria-label="Menü özeti" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Kategori" value={formatNumber(overview.categories)} icon={FolderTree} />
        <StatCard label="Ürün" value={formatNumber(overview.products)} icon={Package} hint="Arşivlenenler hariç" />
        <StatCard label="Aktif ürün" value={formatNumber(overview.active)} icon={PackageCheck} />
        <StatCard label="Tükenen ürün" value={formatNumber(overview.soldOut)} icon={CircleSlash} />
        <StatCard
          label="Görseli olmayan"
          value={formatNumber(overview.missingImages)}
          icon={ImageOff}
          hint={<Link href="/panel/menu/urunler?eksik=gorsel" className="underline underline-offset-4">Listele</Link>}
        />
        <StatCard
          label="Çevirisi eksik"
          value={formatNumber(overview.missingTranslations)}
          icon={Languages}
          hint={`Diller: ${locales.translatable.map((l) => l.toUpperCase()).join(", ")}`}
        />
      </section>

      {aiTranslate ? <AutoTranslateCard missing={missing} locales={locales.translatable} step={translateMenuStepAction} readOnly={!canManage} /> : null}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Son güncellenen ürünler</CardTitle>
          <CardDescription>Menüde en son değişen ürünler.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {overview.recent.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Henüz ürün yok"
              description="Önce bir kategori, ardından ürün ekleyerek menünüzü oluşturun."
              className="m-5"
              action={canManage ? <Link href="/panel/menu/urunler/yeni" className={buttonVariants({ size: "sm" })}>Yeni Ürün</Link> : undefined}
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.recent.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/panel/menu/urunler/${p.id}`} className="font-medium text-fg hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-2 text-sm text-fg-subtle">{p.category.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!p.active ? <Badge>Pasif</Badge> : p.soldOut ? <Badge tone="warning" dot>Tükendi</Badge> : <Badge tone="success" dot>Satışta</Badge>}
                    <time dateTime={p.updatedAt.toISOString()} className="text-xs text-fg-subtle">
                      {formatDateTime(p.updatedAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
