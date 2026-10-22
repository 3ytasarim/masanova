import "server-only";
import { randomBytes } from "node:crypto";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/menu/money";
import { allergenStatus, flattenMenu, fold, hasDietaryTag, searchProducts, type FlatProduct } from "@/lib/ai/menu-match";
import { buildLexicon, resolveSpokenProduct, type VoiceLexicon } from "@/lib/ai/voice-lexicon";
import { recommend } from "@/lib/ai/recommendation";
import { buildGuidance, detectCondition, planMealByCalories, type KnowledgeDocument } from "@/lib/ai/knowledge";
import { findPairings, menuMainsFor, nonAlcoholicDrinks, pairingViews, withPopular, type PairingView, type StoredPairing } from "@/lib/ai/pairings";
import { coOrderedWith } from "@/server/services/ai/co-orders.service";
import { isAiToolName, parseToolArgs, type AiToolName } from "@/lib/ai/tools";
import type { ActionCard, ProductCard, RecommendationBundle } from "@/lib/ai/types";
import type { ItemSelection } from "@/lib/orders/calculate";
import { formatOrderNumber } from "@/lib/orders/status";
import type { PublicMenuView } from "@/lib/public-menu/types";
import { ACTIVE_SLOT } from "@/lib/service-requests/duplicate";
import { PUBLIC_ORDER_WINDOW_MS } from "@/server/repositories/orders.repository";
import { checkCart, type OrderContext } from "@/server/services/orders/submit-order.service";
import type { ToolResult } from "@/server/services/ai/tool-results";
import type { ConversationContext } from "@/lib/ai/conversation-context";

/**
 * Araç yürütücüsü. Bağlam (kiracı / şube / masa) yalnızca sunucuda — araç argümanlarında kimlik yoktur ve olsa da yok
 * sayılır. Ürün verisi güvenilir menü görünümünden (gizli / arşiv ürün içermez). "prepare*" araçları HİÇBİR ŞEYİ
 * DEĞİŞTİRMEZ: doğrulanmış eylem kartı üretir; değişikliği müşteri onaylar ve mevcut iş mantığı (sepet / servis) uygular.
 */
export type ToolContext = {
  order: OrderContext;
  view: PublicMenuView;
  numberLocale: string;
  settings: { allowRecommendations: boolean; allowCartActions: boolean; allowServiceActions: boolean };
  /** İstemcinin bildirdiği sepet (yetkili değil; özet sunucuda yeniden hesaplanır). */
  cart: { key: string; selection: ItemSelection }[];
  /** Bu tarayıcıdan verilen siparişlerin public kimlikleri (masa + 24 saat sunucuda doğrulanır). */
  recentOrders: string[];
  /** Konuşmanın yapılandırılmış bağlamı (kişi, bütçe, diyet, acı): öneri argümanlarında eksik olanlar buradan tamamlanır. */
  context?: ConversationContext;
  /** Platform eğitim kartları (Super Admin › Yapay Zeka Eğit). Verilmezse yerleşik varsayılanlar. */
  knowledge?: KnowledgeDocument[];
  /** İşletmenin yemek eşleştirmeleri (AiSettings.pairings; ürün anahtarları). */
  pairings?: StoredPairing[];
};

export type ToolCollector = { actions: ActionCard[]; products: ProductCard[]; recommendation: RecommendationBundle | null; toolCalls: { name: string; ok: boolean }[] };

const cardId = () => randomBytes(6).toString("base64url");

export function createToolExecutor(ctx: ToolContext) {
  const products = flattenMenu(ctx.view);
  // Ürün adı çözümü: sesli menü sözlüğü (güven puanlı). Belirsiz / zayıf eşleşmede ürün DÖNMEZ — ne söyleneceği döner.
  let lexicon: VoiceLexicon | null = null;
  const resolve = (phrase: string) => resolveSpokenProduct((lexicon ??= buildLexicon(products)), products, phrase);
  const unresolved = (tool: AiToolName, output: Record<string, unknown>) => ({ tool, ...output, ...(output.reason === "not_on_menu" ? { reason: "not_found" } : {}), ok: false }) as unknown as ToolResult;
  const currency = products[0]?.currency ?? "TRY";
  const money = (minor: number) => formatMoney(minor, currency, ctx.numberLocale);
  const collector: ToolCollector = { actions: [], products: [], recommendation: null, toolCalls: [] };
  const pushProduct = (p: FlatProduct, extra: Partial<ProductCard> = {}) => {
    if (collector.products.length >= 6 || collector.products.some((c) => c.product === p.key)) return;
    collector.products.push({ product: p.key, name: p.name, priceLabel: p.priceLabel, soldOut: p.soldOut, ...extra });
  };
  const item = (p: FlatProduct) => ({ key: p.key, name: p.name, category: p.categoryName, priceLabel: p.priceLabel, soldOut: p.soldOut, featured: p.featured, dietaryTags: p.dietaryTags.map((d) => d.name) });
  const requiredChoice = (p: FlatProduct) => p.modifierGroups.find((g) => g.required || g.minSelect > 0)?.name ?? null;

  async function run(name: AiToolName, raw: unknown): Promise<ToolResult> {
    switch (name) {
      case "searchMenu": {
        const a = parseToolArgs("searchMenu", raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" };
        let list = a.query ? searchProducts(products, a.query) : [...products];
        if (a.category) list = list.filter((p) => fold(p.categoryName).includes(fold(a.category!)));
        if (a.dietaryTag) list = list.filter((p) => hasDietaryTag(p, a.dietaryTag!));
        if (a.excludeAllergens?.length) list = list.filter((p) => allergenStatus(p, a.excludeAllergens!) === "not_listed");
        if (a.maxPriceMinor !== undefined) list = list.filter((p) => p.unitPriceMinor <= a.maxPriceMinor!);
        if (!a.includeSoldOut) list = list.filter((p) => !p.soldOut);
        if (a.sort === "price_asc") list.sort((x, y) => x.unitPriceMinor - y.unitPriceMinor);
        if (a.sort === "price_desc") list.sort((x, y) => y.unitPriceMinor - x.unitPriceMinor);
        const limited = list.slice(0, a.limit ?? 6);
        limited.forEach((p) => pushProduct(p));
        return { tool: name, ok: true, items: limited.map(item), total: list.length };
      }
      case "getProductDetails":
      case "getProductAvailability":
      case "getProductPrice": {
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" };
        const r = resolve(a.product);
        if (!r.ok && r.status !== "sold_out") return unresolved(name, r.output);
        const p = r.ok ? r.product : products.find((x) => x.name === r.output.name);
        if (!p) return { tool: name, ok: false, reason: "not_found" } as ToolResult;
        pushProduct(p);
        if (name === "getProductAvailability") return { tool: name, ok: true, name: p.name, soldOut: p.soldOut, priceLabel: p.priceLabel };
        const variants = p.variants.map((v) => ({ name: v.name, priceLabel: v.priceLabel }));
        if (name === "getProductPrice") return { tool: name, ok: true, name: p.name, priceLabel: p.priceLabel, variants };
        return {
          tool: name,
          ok: true,
          product: {
            key: p.key,
            name: p.name,
            description: p.description ?? p.shortDescription,
            ingredients: p.ingredients,
            allergenInfoDeclared: p.allergenInfoDeclared,
            allergens: p.allergens.map((x) => x.name),
            dietaryTags: p.dietaryTags.map((d) => d.name),
            spicy: hasDietaryTag(p, "spicy"),
            soldOut: p.soldOut,
            priceLabel: p.priceLabel,
            variants,
            requiredChoices: p.modifierGroups.filter((g) => g.required || g.minSelect > 0).map((g) => g.name),
          },
        };
      }
      case "getRecommendationCandidates": {
        if (!ctx.settings.allowRecommendations) return { tool: name, ok: false, reason: "disabled" };
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" };
        const c = ctx.context;
        const r = recommend(products, {
          ...a,
          guests: a.guests ?? c?.guests ?? undefined,
          budgetMinor: a.budgetMinor ?? c?.budgetMinor ?? undefined,
          spicy: a.spicy ?? c?.spicy ?? undefined,
          dietGuests: c?.diets.length ? c.diets : undefined,
        });
        const items = r.items.map((i) => ({ key: i.product.key, name: i.product.name, quantity: i.quantity, unitPriceLabel: money(i.product.unitPriceMinor), lineTotalLabel: money(i.lineTotalMinor) }));
        if (!r.empty) {
          collector.recommendation = {
            items: r.items.map((i) => ({
              product: i.product.key,
              name: i.product.name,
              quantity: i.quantity,
              unitPriceLabel: money(i.product.unitPriceMinor),
              lineTotalMinor: i.lineTotalMinor,
              lineTotalLabel: money(i.lineTotalMinor),
              addable: i.product.directlyAddable,
            })),
            totalMinor: r.totalMinor,
            totalLabel: money(r.totalMinor),
            budgetMinor: r.budgetMinor,
            guests: r.guests,
          };
        }
        return { tool: name, ok: true, empty: r.empty, items, totalMinor: r.totalMinor, totalLabel: money(r.totalMinor), budgetMinor: r.budgetMinor, budgetLabel: r.budgetMinor === null ? null : money(r.budgetMinor), guests: r.guests, fitsBudget: r.fitsBudget, unmetDiets: r.unmetDiets, dietPicks: r.dietPicks.map((d) => ({ tag: d.tag, name: products.find((p) => p.key === d.product)?.name ?? d.product })) };
      }
      case "getGuidance": {
        if (!ctx.settings.allowRecommendations) return { tool: name, ok: false, reason: "disabled" };
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" } as unknown as ToolResult;
        return { tool: name, ok: true, guidance: buildGuidance(products, ctx.knowledge ?? [], a.topic, { kind: a.kind, query: a.query }) };
      }
      case "getPairings": {
        if (!ctx.settings.allowRecommendations) return { tool: name, ok: false, reason: "disabled" };
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" } as unknown as ToolResult;
        const lx = (lexicon ??= buildLexicon(products));
        const avoidAlcohol = a.avoidAlcohol === true;
        // 1) Restoranın kayıtlı (elle / yapay zekâyla hazırlanmış) eşleştirmeleri
        const stored = pairingViews(ctx.pairings ?? [], products, { avoidAlcohol });
        let picked = stored.length ? findPairings(stored, products, lx, a) : { match: "all" as const, pairings: [] as PairingView[] };
        // 2) Kayıtlı eşleştirme yoksa: sorulan yemek / konu için menüdeki ana yemekler (yalnızca sipariş geçmişiyle doldurulur)
        if (!stored.length || picked.match === "all") {
          const mains = menuMainsFor(products, lx, a);
          if (mains.length && !stored.some((v) => mains.some((m) => m.key === v.mainKey)))
            picked = { match: "topic", pairings: mains.map((m) => ({ mainKey: m.key, main: m.name, category: m.categoryName, price: m.priceLabel, sides: [], drinks: [], desserts: [] })) };
        }
        // 3) Müşteri davranışı: bu yemeklerle aynı siparişte en sık istenenler (son 180 gün, en az 2 sipariş)
        let withData = picked.pairings;
        try {
          withData = withPopular(picked.pairings, await coOrderedWith(ctx.order.tenantId, picked.pairings.map((v) => v.mainKey)), products, { avoidAlcohol });
        } catch {
          // Sipariş istatistiği isteğe bağlı: okunamazsa kayıtlı eşleştirmeler yeterli.
        }
        const useful = withData.filter((v) => v.sides.length || v.drinks.length || v.desserts.length || v.popular?.length);
        const softDrinks = avoidAlcohol ? nonAlcoholicDrinks(products) : undefined;
        if (!useful.length) return { tool: name, ok: true, match: "none", pairings: [], ...(softDrinks ? { nonAlcoholicDrinks: softDrinks } : {}), note: "Restoranın tanımlı eşleştirmesi ve yeterli sipariş verisi yok; menüden kendi gastronomik önerini yap." };
        return {
          tool: name,
          ok: true,
          match: picked.match,
          pairings: useful,
          ...(softDrinks ? { nonAlcoholicDrinks: softDrinks } : {}),
          note: "sides / drinks / desserts = restoranın önerisi; nonAlcoholicDrinks = alkolsüz içecek önerirken YALNIZCA bunlardan, adını aynen söyle; popular = misafirlerin bu yemekle en çok birlikte sipariş ettikleri (gerçek sipariş verisi). Doğal bir cümleyle, önce yemek, sonra meze ve içecek, sorulursa tatlı sırasıyla söyle.",
        };
      }
      case "planMealByCalories": {
        if (!ctx.settings.allowRecommendations) return { tool: name, ok: false, reason: "disabled" };
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" } as unknown as ToolResult;
        return { tool: name, ok: true, result: planMealByCalories(products, { maxCalories: a.maxCalories, condition: a.topic ? detectCondition(a.topic) : null, query: a.query }) };
      }
      case "getCartSummary": {
        if (!ctx.cart.length) return { tool: name, ok: true, lines: [], totalLabel: money(0) };
        // Yetkili özet: fiyat / uygunluk sunucuda (istemci toplamına güvenilmez).
        const check = await checkCart(ctx.order, { items: ctx.cart.map((c) => c.selection), locale: ctx.view.locale });
        let total = 0;
        const lines = ctx.cart.map((c, i) => {
          const status = check.lines[i]?.status ?? "invalid";
          const unit = check.currentUnitPrices[i] ?? 0;
          const lineTotal = status === "ok" || status === "price_changed" ? unit * c.selection.quantity : 0;
          total += lineTotal;
          const p = products.find((x) => x.key === c.selection.product);
          return { name: p?.name ?? c.selection.product, quantity: c.selection.quantity, lineTotalLabel: money(lineTotal), status };
        });
        return { tool: name, ok: true, lines, totalLabel: money(total) };
      }
      case "getOrderStatus": {
        if (!ctx.recentOrders.length) return { tool: name, ok: true, orders: [] };
        const rows = await prisma.order.findMany({
          where: { publicId: { in: ctx.recentOrders.slice(0, 10) }, tenantId: ctx.order.tenantId, tableId: ctx.order.tableId, createdAt: { gte: new Date(Date.now() - PUBLIC_ORDER_WINDOW_MS) } },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { orderNumber: true, status: true },
        });
        return { tool: name, ok: true, orders: rows.map((r: { orderNumber: number; status: OrderStatus }) => ({ number: formatOrderNumber(r.orderNumber), status: r.status })) };
      }
      case "prepareCartAddition": {
        if (!ctx.settings.allowCartActions) return { tool: name, ok: false, reason: "disabled" };
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" };
        const r = resolve(a.product);
        if (!r.ok) return r.status === "sold_out" ? { tool: name, ok: false, reason: "sold_out", name: String(r.output.name) } : unresolved(name, r.output);
        const p = r.product;
        // Varyant: açıkça söylenen ad eşleşirse; birden fazla varyant ve eşleşme yoksa TAHMİN YOK → yapılandırıcı.
        const variantPhrase = fold(a.variant ?? "");
        const variant = p.variants.length === 1 ? p.variants[0]! : p.variants.find((v) => variantPhrase && (` ${variantPhrase} `.includes(` ${fold(v.name)} `) || variantPhrase === fold(v.name))) ?? null;
        const choice = requiredChoice(p);
        const configure = (reason: "required_modifiers" | "variant_choice"): ToolResult => {
          collector.actions.push({ kind: "configure", id: cardId(), product: p.key, name: variant ? `${p.name} (${variant.name})` : p.name, reason });
          pushProduct(p);
          return { tool: name, ok: true, action: "configure", name: variant ? `${variant.name} ${p.name}` : p.name, reason, requiredChoice: reason === "required_modifiers" ? choice : null };
        };
        if (p.variants.length > 1 && !variant) return configure("variant_choice");
        if (choice) return configure("required_modifiers");
        const unit = variant ? variant.priceMinor : p.basePriceMinor;
        const quantity = a.quantity;
        collector.actions.push({
          kind: "cart_add",
          id: cardId(),
          line: { product: p.key, variant: variant?.ref ?? null, modifiers: [], quantity, note: null, unitPriceMinor: unit, name: p.name, detail: variant && p.variants.length > 1 ? variant.name : "" },
          totalMinor: unit * quantity,
          totalLabel: money(unit * quantity),
        });
        return { tool: name, ok: true, action: "add", name: p.name, quantity, totalLabel: money(unit * quantity) };
      }
      case "prepareCartChange": {
        if (!ctx.settings.allowCartActions) return { tool: name, ok: false, reason: "disabled" };
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" };
        const r = resolve(a.product);
        const p = r.ok ? r.product : r.status === "sold_out" ? products.find((x) => x.name === r.output.name) : undefined;
        const line = p ? ctx.cart.find((c) => c.selection.product === p.key) : undefined;
        if (!p || !line) return { tool: name, ok: false, reason: "not_in_cart" };
        collector.actions.push({ kind: "cart_change", id: cardId(), lineKey: line.key, name: p.name, quantity: a.quantity });
        return { tool: name, ok: true, name: p.name, quantity: a.quantity };
      }
      case "prepareServiceRequest": {
        if (!ctx.settings.allowServiceActions) return { tool: name, ok: false, reason: "disabled" };
        const a = parseToolArgs(name, raw);
        if (!a) return { tool: name, ok: false, error: "invalid_arguments" };
        // Bilgi amaçlı ön kontrol; asıl mükerrer koruması onayda Sprint 8 servisinde (veritabanı garantisi).
        const active = await prisma.tableServiceRequest.findFirst({ where: { tenantId: ctx.order.tenantId, tableId: ctx.order.tableId, type: a.type, activeSlot: ACTIVE_SLOT }, select: { id: true } });
        if (!active) collector.actions.push({ kind: "service", id: cardId(), type: a.type });
        return { tool: name, ok: true, type: a.type, alreadyActive: !!active };
      }
      case "openCartReview": {
        if (!ctx.settings.allowCartActions) return { tool: name, ok: false, reason: "disabled" };
        if (!collector.actions.some((x) => x.kind === "open_cart")) collector.actions.push({ kind: "open_cart", id: cardId() });
        return { tool: name, ok: true, cartLines: ctx.cart.length };
      }
    }
  }

  return {
    collector,
    products,
    async execute(name: string, raw: unknown): Promise<ToolResult> {
      if (!isAiToolName(name)) return { tool: name, ok: false, error: "unknown_tool" };
      const result = await run(name, raw);
      collector.toolCalls.push({ name, ok: result.ok });
      return result;
    },
  };
}
