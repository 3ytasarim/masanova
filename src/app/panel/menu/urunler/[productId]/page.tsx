import { Archive, ArrowLeft, CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MENU_LOCALE_LABELS } from "@/config/menu";
import { resolveAvailability } from "@/lib/menu/availability";
import { productCompleteness } from "@/lib/menu/completeness";
import { formatMoney, minorToInput } from "@/lib/menu/money";
import { resolveProductPrice } from "@/lib/menu/pricing";
import { translatedName } from "@/lib/menu/translation";
import { resolveProductImage } from "@/server/media/urls";
import { formatDateTime } from "@/lib/utils/format";
import { CURRENCIES } from "@/lib/validation/intl";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import {
  productImageAction,
  productModifierGroupAction,
  productQuickAction,
  saveBranchOverrideAction,
  saveProductTranslationsAction,
  saveVariantAction,
  updateProductContentAction,
  updateProductGeneralAction,
  updateProductPricingAction,
  variantQuickAction,
} from "@/server/actions/menu.actions";
import { listBranchesDetailed } from "@/server/repositories/branch.repository";
import { getMenuLibrary, getProductEditor, listBranchVariantPrices, listCategoryOptions, listModifierGroups } from "@/server/repositories/menu.repository";
import { getProductStationRouting } from "@/server/repositories/kds.repository";
import { getMenuPageContext } from "@/server/menu-page-context";
import { saveProductStationsAction } from "@/server/actions/station.actions";
import { ProductStationsPanel } from "@/components/kds/product-stations-panel";
import { ContentForm, GeneralForm, PricingForm, ProductTranslationsForm } from "@/components/menu/product-editor/editor-forms";
import { BranchesPanel, ImagesPanel, ModifiersPanel, VariantsPanel } from "@/components/menu/product-editor/editor-panels";
import { EditorTabs } from "@/components/menu/product-editor/editor-tabs";
import { QuickAction } from "@/components/menu/quick-action";
import { toTranslationValues } from "@/components/menu/translation-fields";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Ürün" };

const TAB_IDS = ["genel", "fiyat", "varyasyonlar", "ekstralar", "icerik", "gorseller", "ceviriler", "subeler", "istasyonlar"] as const;
const AVAILABILITY_LABEL = { available: "Satışta", sold_out: "Tükendi", unavailable: "Menüde değil" } as const;

/**
 * Ürün editörü. Ürün YALNIZCA oturumdaki kiracının kapsamında aranır: başka kiracının ürün kimliği 404 olur.
 * Bu rotanın üstünde yükleme sınırı yoktur (notFound gerçek 404 döner).
 */
export default async function ProductEditorPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<RawSearchParams> }) {
  const { productId } = await params;
  const { scope, canManage, locales } = await getMenuPageContext();
  if (!/^[a-z0-9_]{1,40}$/i.test(productId)) notFound();
  const product = await getProductEditor(scope, productId);
  if (!product) notFound();

  const [categories, groups, library, branches, branchVariantPrices, routing, sp] = await Promise.all([
    listCategoryOptions(scope),
    listModifierGroups(scope),
    getMenuLibrary(scope),
    listBranchesDetailed(scope),
    listBranchVariantPrices(scope, product.id),
    getProductStationRouting(scope, product.id),
    searchParams,
  ]);
  const archived = product.archivedAt !== null;
  const readOnly = !canManage || archived;
  const { defaultLocale, translatable } = locales;
  const money = (minor: number) => formatMoney(minor, product.currency);

  const roots = categories.filter((c) => c.parentId === null);
  const categoryOptions = roots.flatMap((r) => [
    { value: r.id, label: r.name },
    ...categories.filter((c) => c.parentId === r.id).map((c) => ({ value: c.id, label: `${r.name} › ${c.name}` })),
  ]);

  const completeness = productCompleteness({
    basePriceMinor: product.basePriceMinor,
    shortDescription: product.shortDescription,
    description: product.description,
    imageCount: product.images.length,
    variantPrices: product.variants.filter((v) => v.active).map((v) => v.priceMinor),
    allergensConfirmedAt: product.allergensConfirmedAt,
    allergenCount: product.allergens.length,
    translations: product.translations,
    translatableLocales: translatable,
  });

  const variantPriceMap = new Map(branchVariantPrices.map((p) => [`${p.branchId}:${p.variantId}`, p.priceMinor]));
  const attachedIds = new Set(product.modifierGroups.map((m) => m.group.id));
  const tab = TAB_IDS.find((t) => t === param(sp, "sekme", 20)) ?? "genel";

  const ruleText = (g: { required: boolean; minSelect: number; maxSelect: number }) =>
    `${g.required ? "Zorunlu" : "İsteğe bağlı"} · ${g.minSelect === g.maxSelect ? `${g.maxSelect} seçim` : `${g.minSelect}–${g.maxSelect} seçim`}`;

  const pricingPreview = (
    <Table>
      <THead>
        <TR>
          <TH>Şube</TH>
          <TH>Seçenek</TH>
          <TH className="text-right">Fiyat</TH>
          <TH>Kaynak</TH>
        </TR>
      </THead>
      <TBody>
        {branches.flatMap((b) => {
          const branchProduct = product.branchOverrides.find((o) => o.branchId === b.id) ?? null;
          const rows = product.variants.length
            ? product.variants.map((v) => ({
                key: `${b.id}-${v.id}`,
                label: v.name,
                price: resolveProductPrice({
                  product,
                  branchProduct,
                  variant: v,
                  branchVariant: variantPriceMap.has(`${b.id}:${v.id}`) ? { priceMinor: variantPriceMap.get(`${b.id}:${v.id}`)! } : null,
                }),
              }))
            : [{ key: b.id, label: "—", price: resolveProductPrice({ product, branchProduct }) }];
          const sourceLabel = { branch_variant: "Şube varyant fiyatı", variant: "Varyant fiyatı", branch_product: "Şube fiyatı", product: "Taban fiyat" } as const;
          return rows.map((r) => (
            <TR key={r.key}>
              <TD label="Şube">{b.name}</TD>
              <TD label="Seçenek">{r.label}</TD>
              <TD label="Fiyat" className="text-right tabular-nums text-fg">{money(r.price.amountMinor)}</TD>
              <TD label="Kaynak"><Badge>{sourceLabel[r.price.source]}</Badge></TD>
            </TR>
          ));
        })}
      </TBody>
    </Table>
  );

  const items = [
    {
      id: "genel",
      label: "Genel",
      content: (
        <GeneralForm
          action={updateProductGeneralAction.bind(null, product.id)}
          readOnly={readOnly}
          categories={categoryOptions}
          product={{
            name: product.name,
            slug: product.slug,
            categoryId: product.categoryId,
            shortDescription: product.shortDescription ?? "",
            description: product.description ?? "",
            sku: product.sku ?? "",
            preparationMinutes: product.preparationMinutes?.toString() ?? "",
            featured: product.featured,
            active: product.active,
            soldOut: product.soldOut,
          }}
        />
      ),
    },
    {
      id: "fiyat",
      label: "Fiyatlandırma",
      content: (
        <div className="grid gap-6">
          <PricingForm action={updateProductPricingAction.bind(null, product.id)} readOnly={readOnly} basePrice={minorToInput(product.basePriceMinor)} currency={product.currency} currencies={CURRENCIES} />
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Çözümlenmiş fiyatlar</h3>
            <p className="text-[0.8125rem] text-fg-subtle">Öncelik: şube varyant fiyatı → varyant fiyatı → şube fiyatı → taban fiyat. Ekstralar bu fiyata eklenir.</p>
            {pricingPreview}
          </div>
        </div>
      ),
    },
    {
      id: "varyasyonlar",
      label: `Varyasyonlar${product.variants.length ? ` (${product.variants.length})` : ""}`,
      content: (
        <VariantsPanel
          readOnly={readOnly}
          locales={translatable}
          saveAction={saveVariantAction.bind(null, product.id)}
          quickAction={variantQuickAction.bind(null, product.id)}
          variants={product.variants.map((v) => ({
            id: v.id,
            name: v.name,
            sku: v.sku ?? "",
            price: minorToInput(v.priceMinor),
            priceLabel: v.priceMinor === null ? `${money(product.basePriceMinor)} (taban)` : money(v.priceMinor),
            active: v.active,
            isDefault: v.isDefault,
            translations: toTranslationValues(v.translations),
          }))}
        />
      ),
    },
    {
      id: "ekstralar",
      label: `Ekstralar${product.modifierGroups.length ? ` (${product.modifierGroups.length})` : ""}`,
      content: (
        <ModifiersPanel
          readOnly={readOnly}
          action={productModifierGroupAction.bind(null, product.id)}
          attached={product.modifierGroups.map(({ group }) => ({ id: group.id, name: group.name, rule: ruleText(group), modifierCount: group._count.modifiers, active: group.active && !group.archivedAt }))}
          available={groups.filter((g) => !attachedIds.has(g.id)).map((g) => ({ id: g.id, name: g.name }))}
        />
      ),
    },
    {
      id: "icerik",
      label: "İçerik & Alerjen",
      content: (
        <ContentForm
          action={updateProductContentAction.bind(null, product.id)}
          readOnly={readOnly}
          ingredients={library.ingredients.map((i) => ({ id: i.id, name: i.name, active: i.active }))}
          allergens={library.allergens.filter((a) => a.active || product.allergens.some((p) => p.allergenId === a.id)).map((a) => ({ id: a.id, name: translatedName(a.name, a.translations, defaultLocale, defaultLocale), custom: a.tenantId !== null }))}
          dietaryTags={library.dietaryTags.filter((t) => t.active || product.dietaryTags.some((p) => p.dietaryTagId === t.id)).map((t) => ({ id: t.id, code: t.code, name: translatedName(t.name, t.translations, defaultLocale, defaultLocale), custom: t.tenantId !== null }))}
          selected={{
            ingredientIds: product.ingredients.map((i) => i.ingredientId),
            allergenIds: product.allergens.map((a) => a.allergenId),
            dietaryTagIds: product.dietaryTags.map((t) => t.dietaryTagId),
          }}
          allergensConfirmed={product.allergensConfirmedAt !== null}
          nutrition={{
            calories: product.calories?.toString() ?? "",
            proteinGrams: product.proteinGrams?.toString() ?? "",
            carbohydrateGrams: product.carbohydrateGrams?.toString() ?? "",
            fatGrams: product.fatGrams?.toString() ?? "",
          }}
        />
      ),
    },
    {
      id: "gorseller",
      label: `Görseller${product.images.length ? ` (${product.images.length})` : ""}`,
      content: (
        <ImagesPanel
          productId={product.id}
          readOnly={readOnly}
          action={productImageAction.bind(null, product.id)}
          images={product.images.map((img) => ({ id: img.id, url: resolveProductImage(img)?.url ?? null, altText: img.altText ?? "", isPrimary: img.isPrimary, managed: img.storageProvider === "media" }))}
        />
      ),
    },
    {
      id: "ceviriler",
      label: "Çeviriler",
      content: (
        <ProductTranslationsForm
          action={saveProductTranslationsAction.bind(null, product.id)}
          readOnly={readOnly}
          locales={translatable}
          values={toTranslationValues(product.translations)}
          canonical={{ locale: defaultLocale, name: product.name }}
        />
      ),
    },
    {
      id: "subeler",
      label: "Şubeler",
      content: (
        <BranchesPanel
          readOnly={readOnly}
          action={saveBranchOverrideAction.bind(null, product.id)}
          basePriceLabel={money(product.basePriceMinor)}
          branches={branches.map((b) => {
            const override = product.branchOverrides.find((o) => o.branchId === b.id) ?? null;
            const tri = (v: boolean | null | undefined) => (v === null || v === undefined ? "inherit" : v ? "yes" : "no") as "inherit" | "yes" | "no";
            const availability = resolveAvailability({ product, category: product.category, branch: b, branchProduct: override });
            return {
              branchId: b.id,
              branchName: b.name,
              branchActive: b.active,
              available: tri(override?.available),
              soldOut: tri(override?.soldOut),
              price: minorToInput(override?.priceMinor ?? null),
              resolvedLabel: money(resolveProductPrice({ product, branchProduct: override }).amountMinor),
              availabilityLabel: AVAILABILITY_LABEL[availability.status],
              variants: product.variants.map((v) => {
                const branchPrice = variantPriceMap.get(`${b.id}:${v.id}`);
                return {
                  id: v.id,
                  name: v.name,
                  price: minorToInput(branchPrice ?? null),
                  resolvedLabel: money(resolveProductPrice({ product, branchProduct: override, variant: v, branchVariant: branchPrice === undefined ? null : { priceMinor: branchPrice } }).amountMinor),
                };
              }),
            };
          })}
        />
      ),
    },
    {
      id: "istasyonlar",
      label: "İstasyonlar",
      content: (
        <ProductStationsPanel
          readOnly={readOnly}
          action={saveProductStationsAction.bind(null, product.id)}
          branches={routing.branches.map((b) => ({
            branchId: b.id,
            branchName: b.name,
            defaultStationName: b.stations.find((st) => st.id === b.defaultStationId && st.active)?.name ?? null,
            stations: b.stations.map((st) => ({ id: st.id, name: st.name, active: st.active })),
            selected: routing.assignments.filter((a) => a.branchId === b.id).map((a) => a.stationId),
          }))}
        />
      ),
    },
  ];

  return (
    <>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link href="/panel/menu/urunler" className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg">
            <ArrowLeft aria-hidden="true" className="size-4" /> Ürünler
          </Link>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{product.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-subtle">
            {archived ? <Badge>Arşivde</Badge> : !product.active ? <Badge>Pasif</Badge> : product.soldOut ? <Badge tone="warning" dot>Tükendi</Badge> : <Badge tone="success" dot>Satışta</Badge>}
            {product.featured ? <Badge tone="accent">Öne çıkan</Badge> : null}
            <span>{product.category.name}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{money(product.basePriceMinor)}</span>
            <span aria-hidden="true">·</span>
            <span>Güncellendi {formatDateTime(product.updatedAt)}</span>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {archived ? (
              <QuickAction action={productQuickAction} fields={{ id: product.id, op: "restore" }} label="Arşivden çıkar" className="border border-border-strong px-3">
                <RotateCcw aria-hidden="true" /> Arşivden çıkar
              </QuickAction>
            ) : (
              <>
                <QuickAction
                  action={productQuickAction}
                  fields={{ id: product.id, op: "soldOut", value: String(!product.soldOut) }}
                  label={product.soldOut ? "Yeniden satışa aç" : "Tükendi işaretle"}
                  className="border border-border-strong px-3"
                >
                  {product.soldOut ? "Yeniden satışa aç" : "Tükendi işaretle"}
                </QuickAction>
                <ConfirmDialog
                  action={productQuickAction}
                  hidden={{ id: product.id, op: "archive" }}
                  triggerLabel={
                    <>
                      <Archive aria-hidden="true" /> Arşivle
                    </>
                  }
                  title={`${product.name} arşivlensin mi?`}
                  description="Ürün menüden ve listelerden kalkar. Kayıt, varyantlar ve geçmiş korunur; istediğiniz zaman arşivden çıkarabilirsiniz. Ürünler fiziksel olarak silinmez."
                  confirmLabel="Arşivle"
                  destructive
                />
              </>
            )}
          </div>
        ) : null}
      </div>

      <Card className="mb-6">
        <CardContent>
          {completeness.issues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CircleCheck aria-hidden="true" className="size-4" /> İçerik eksiksiz.
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <p className="flex shrink-0 items-center gap-2 text-sm font-medium text-warning">
                <TriangleAlert aria-hidden="true" className="size-4" /> İçerik %{completeness.score}
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Eksik içerik">
                {completeness.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.locale ?? ""}`}>
                    <Badge tone="warning">{issue.label}</Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-subtle sm:ml-auto">Uyarılar yayını engellemez.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {archived ? <p className="mb-4 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-muted">Bu ürün arşivde; düzenlemek için önce arşivden çıkarın.</p> : null}
      <p className="sr-only">Desteklenen menü dilleri: {translatable.map((l) => MENU_LOCALE_LABELS[l] ?? l).join(", ")}</p>
      <EditorTabs defaultTab={tab} items={items} />
    </>
  );
}
