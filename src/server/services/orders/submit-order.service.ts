import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calculateOrder, type CalculatedLine, type ItemSelection, type LineIssue, type OrderCalculation } from "@/lib/orders/calculate";
import { hashIdempotencyKey, hashOrderRequest, newPublicOrderId } from "@/lib/orders/idempotency";
import { ORDER_NUMBER_START } from "@/lib/orders/status";
import { ACCESSIBLE_TENANT_STATUSES } from "@/lib/tenant/resolve-tenant";
import type { SubmitOrderInput } from "@/lib/validation/orders";
import { publishOrderStatus } from "@/server/realtime/bus";
import { buildAuditRow } from "@/server/services/audit.service";
import { loadOrderCatalog } from "@/server/services/orders/catalog.service";
import { exclusivePromotion, type PromotionRequest } from "@/lib/promotions/engine";
import { resolvePromotion, type PromotionFailure, type ResolvedPromotion } from "@/server/promotions/resolve";
import { resolveEntitlements } from "@/server/billing/entitlements";

/**
 * QR masa siparişi gönderimi.
 *
 * Güven modeli: kiracı / şube / masa / token YALNIZCA sunucuda QR bağlamından (getTableQrContext) gelir. İstemciden
 * yalnızca seçimler alınır; fiyat ve toplam yetkili katalogdan (önbelleksiz) merkezi hesaplayıcıyla bulunur.
 *
 * Akış:
 *   1. Tekrarlanan gönderim: (kiracı, anahtar özeti) varsa → aynı içerikse mevcut sipariş döner, değilse ret.
 *   2. Tek transaction: bağlam yeniden doğrulanır (token / masa / bölge / şube / kiracı) → katalog → hesap.
 *      Herhangi bir uyuşmazlık (fiyat değişti, tükendi, geçersiz seçim) → HİÇBİR ŞEY yazılmaz, mutabakat döner.
 *   3. Şube sayacından numara (atomik upsert) → sipariş + kalemler + ekstralar + ilk durum + denetim kaydı.
 *   4. Eşzamanlı aynı anahtar → benzersiz kısıt ihlali → mevcut sipariş döner (tek sipariş).
 */

export type OrderContext = {
  tenantId: string;
  branchId: string;
  tableId: string;
  tokenId: string;
  branchName: string;
  tableName: string;
  areaName: string | null;
  defaultLocale: string;
  /** İsteğe bağlı müşteri kimliği (müşteri oturumundan; masa yetkisi DEĞİLDİR). Yoksa sipariş anonimdir. */
  customerId?: string | null;
};

export type OrderSummary = { publicId: string; orderNumber: number; subtotalMinor: number; discountMinor: number; totalMinor: number; currency: string; itemCount: number; status: string; tableName: string };

export type ReconcileLine = {
  index: number;
  status: "ok" | "price_changed" | "sold_out" | "unavailable" | "invalid";
  fromMinor?: number;
  toMinor?: number;
  issues: LineIssue["code"][];
};

export type SubmitOrderResult =
  | { kind: "created" | "duplicate"; order: OrderSummary }
  | { kind: "reconcile"; lines: ReconcileLine[]; orderIssues: OrderCalculation["orderIssues"] }
  | { kind: "rejected"; reason: "context_invalid" | "idempotency_conflict" | "feature_disabled" }
  /** Kupon / ödül gönderim anında geçersiz: sipariş OLUŞMADI, hiçbir kullanım / puan tüketilmedi. */
  | { kind: "promotion_rejected"; reason: PromotionFailure };

class ContextInvalid extends Error {}
class OrderingDisabled extends Error {}
class PromotionRejected extends Error {
  constructor(readonly reason: PromotionFailure) {
    super(reason);
  }
}
class Reconcile extends Error {
  constructor(readonly calc: OrderCalculation) {
    super("reconcile");
  }
}

export function reconcileLines(calc: OrderCalculation): ReconcileLine[] {
  return calc.lines.map((line: CalculatedLine) => {
    const codes = line.issues.map((i) => i.code);
    const price = line.issues.find((i): i is Extract<LineIssue, { code: "price_changed" }> => i.code === "price_changed");
    const status: ReconcileLine["status"] = codes.includes("product_unavailable")
      ? "unavailable"
      : codes.includes("sold_out")
        ? "sold_out"
        : codes.some((c) => c !== "price_changed")
          ? "invalid"
          : price
            ? "price_changed"
            : "ok";
    return { index: line.index, status, ...(price ? { fromMinor: price.fromMinor, toMinor: price.toMinor } : {}), issues: codes };
  });
}

const summaryOf = (o: { publicId: string; orderNumber: number; subtotalMinor: number; discountMinor: number; totalMinor: number; currency: string; itemCount: number; status: string; tableName: string }): OrderSummary => ({
  publicId: o.publicId,
  orderNumber: o.orderNumber,
  subtotalMinor: o.subtotalMinor,
  discountMinor: o.discountMinor,
  totalMinor: o.totalMinor,
  currency: o.currency,
  itemCount: o.itemCount,
  status: o.status,
  tableName: o.tableName,
});

async function findByKey(tenantId: string, keyHash: string) {
  return prisma.order.findUnique({ where: { tenantId_idempotencyKeyHash: { tenantId, idempotencyKeyHash: keyHash } } });
}

/** Sepeti doğrular ama yazmaz (sepet açılırken / gözden geçirmede uygunluk yenilemesi). */
export async function checkCart(ctx: OrderContext, input: { items: ItemSelection[]; locale: string }) {
  const branch = await prisma.branch.findFirst({ where: { id: ctx.branchId, tenantId: ctx.tenantId }, select: { id: true, active: true } });
  if (!branch) return { lines: [], currentUnitPrices: [], orderIssues: ["empty" as const] };
  const catalog = await loadOrderCatalog(prisma, { tenantId: ctx.tenantId, branch, productKeys: input.items.map((i) => i.product), locale: input.locale, defaultLocale: ctx.defaultLocale });
  const calc = calculateOrder(catalog, input.items, { checkExpectedPrice: true });
  return { lines: reconcileLines(calc), currentUnitPrices: calc.lines.map((l) => l.unitPriceMinor), orderIssues: calc.orderIssues };
}

export async function submitOrder(ctx: OrderContext, input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const items: ItemSelection[] = input.items.map((i) => ({ ...i, expectedUnitPriceMinor: i.expectedUnitPriceMinor ?? null }));
  const keyHash = hashIdempotencyKey(input.idempotencyKey);
  const exclusive = exclusivePromotion({ couponCode: input.promotion?.kind === "coupon" ? input.promotion.code : null, rewardId: input.promotion?.kind === "reward" ? input.promotion.rewardId : null });
  if (exclusive === "stacking") return { kind: "promotion_rejected", reason: "stacking" };
  const promotionRequest: PromotionRequest = exclusive;
  const requestHash = hashOrderRequest({ tableId: ctx.tableId, items, note: input.note, promotion: promotionRequest ? (promotionRequest.kind === "coupon" ? `c:${promotionRequest.code.trim().toUpperCase()}` : `r:${promotionRequest.rewardId}`) : null });

  const replay = async (): Promise<SubmitOrderResult | null> => {
    const existing = await findByKey(ctx.tenantId, keyHash);
    if (!existing) return null;
    if (existing.requestHash !== requestHash || existing.tableId !== ctx.tableId) return { kind: "rejected", reason: "idempotency_conflict" };
    return { kind: "duplicate", order: summaryOf(existing) };
  };
  const previous = await replay();
  if (previous) return previous;

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        // Bağlam transaction içinde YENİDEN doğrulanır (QR ödeme sırasında iptal edildiyse sipariş oluşmaz).
        const token = await tx.tableQrToken.findFirst({
          where: {
            id: ctx.tokenId,
            tenantId: ctx.tenantId,
            tableId: ctx.tableId,
            active: true,
            revokedAt: null,
            table: { active: true, branch: { active: true }, OR: [{ diningAreaId: null }, { area: { active: true } }] },
            tenant: { status: { in: [...ACCESSIBLE_TENANT_STATUSES] } },
          },
          select: { id: true },
        });
        if (!token) throw new ContextInvalid();
        // Paket kapısı (Sprint 20): SON karar transaction içinde, taze yetkiyle — sayfa durumu / önbellek esas alınmaz.
        const ent = await resolveEntitlements(ctx.tenantId, { db: tx });
        if (!ent.has("ordering")) throw new OrderingDisabled();
        // CRM yoksa sipariş müşteriye BAĞLANMAZ (anonim); promosyon (ödül için ayrıca sadakat) yoksa promosyon reddedilir.
        const customerId = ent.has("crm") ? (ctx.customerId ?? null) : null;
        if (promotionRequest && (!ent.has("promotions") || (promotionRequest.kind === "reward" && !ent.has("loyalty")))) throw new PromotionRejected("feature_disabled");

        const catalog = await loadOrderCatalog(tx, {
          tenantId: ctx.tenantId,
          branch: { id: ctx.branchId, active: true },
          productKeys: items.map((i) => i.product),
          locale: input.locale,
          defaultLocale: ctx.defaultLocale,
        });
        const calc = calculateOrder(catalog, items, { checkExpectedPrice: true });
        if (!calc.ok || !calc.currency) throw new Reconcile(calc);

        // Promosyon: YETKİLİ fiyatlarla, kilit altında (kupon satırı / sadakat hesabı). Geçersizse hiçbir şey yazılmaz.
        let promotion: ResolvedPromotion | null = null;
        if (promotionRequest) {
          const resolved = await resolvePromotion(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, customerId, request: promotionRequest, lines: calc.lines, subtotalMinor: calc.subtotalMinor, lock: true });
          if (!resolved.ok) throw new PromotionRejected(resolved.reason);
          promotion = resolved.promotion;
        }
        const discountMinor = promotion?.discountMinor ?? 0;

        // Şube sayacı: tek atomik ifade; satır kilidi bu transaction bitene kadar yalnızca bu şubeyi sıraya sokar.
        const [{ last_number: orderNumber }] = await tx.$queryRaw<{ last_number: number }[]>`
          INSERT INTO order_sequences (branch_id, tenant_id, last_number) VALUES (${ctx.branchId}, ${ctx.tenantId}, ${ORDER_NUMBER_START})
          ON CONFLICT (branch_id) DO UPDATE SET last_number = order_sequences.last_number + 1
          RETURNING last_number`;

        const order = await tx.order.create({
          data: {
            tenantId: ctx.tenantId,
            branchId: ctx.branchId,
            tableId: ctx.tableId,
            qrTokenId: ctx.tokenId,
            customerId,
            publicId: newPublicOrderId(),
            orderNumber,
            currency: calc.currency,
            subtotalMinor: calc.subtotalMinor,
            discountMinor,
            totalMinor: calc.subtotalMinor - discountMinor,
            itemCount: calc.itemCount,
            customerNote: input.note,
            locale: input.locale,
            branchName: ctx.branchName,
            tableName: ctx.tableName,
            areaName: ctx.areaName,
            idempotencyKeyHash: keyHash,
            requestHash,
          },
        });

        const orderItems = await tx.orderItem.createManyAndReturn({
          data: calc.lines.map((line) => ({
            tenantId: ctx.tenantId,
            orderId: order.id,
            productId: line.product!.id ?? null,
            variantId: line.variant?.id ?? null,
            productName: line.product!.name,
            productNameDefault: line.product!.nameDefault ?? line.product!.name,
            variantName: line.variant?.name ?? null,
            basePriceMinor: line.basePriceMinor,
            modifiersTotalMinor: line.modifiersTotalMinor,
            unitPriceMinor: line.unitPriceMinor,
            quantity: line.quantity,
            lineTotalMinor: line.lineTotalMinor,
            note: line.note,
            sortOrder: line.index,
          })),
          select: { id: true, sortOrder: true },
        });
        const itemIdByIndex = new Map(orderItems.map((i) => [i.sortOrder, i.id]));
        const modifierRows = calc.lines.flatMap((line) =>
          line.modifiers.map((m, i) => ({
            tenantId: ctx.tenantId,
            orderItemId: itemIdByIndex.get(line.index)!,
            modifierId: m.modifier.id ?? null,
            modifierGroupId: m.group.id ?? null,
            groupName: m.group.name,
            modifierName: m.modifier.name,
            priceDeltaMinor: m.modifier.priceDeltaMinor,
            sortOrder: i,
          })),
        );
        if (modifierRows.length) await tx.orderItemModifier.createMany({ data: modifierRows });
        await tx.orderStatusHistory.create({ data: { tenantId: ctx.tenantId, orderId: order.id, fromStatus: null, toStatus: "SUBMITTED", actorType: "CUSTOMER" } });
        if (promotion) {
          // Değiştirilemez kopya + kullanım kaydı / puan düşümü — siparişle AYNI transaction (sipariş yoksa tüketim yok).
          await tx.orderPromotion.create({
            data: { tenantId: ctx.tenantId, orderId: order.id, kind: promotion.kind, couponId: promotion.couponId, rewardId: promotion.rewardId, codeSnapshot: promotion.codeSnapshot, label: promotion.label, promotionType: promotion.promotionType, discountMinor: promotion.discountMinor, pointsSpent: promotion.pointsCost, freeItemName: promotion.freeItemName },
          });
          if (promotion.kind === "COUPON") {
            await tx.couponRedemption.create({ data: { tenantId: ctx.tenantId, couponId: promotion.couponId!, orderId: order.id, customerId, codeSnapshot: promotion.codeSnapshot!, discountMinor: promotion.discountMinor } });
          } else {
            await tx.loyaltyLedger.create({ data: { tenantId: ctx.tenantId, accountId: promotion.loyaltyAccountId!, type: "REDEEM", points: -promotion.pointsCost!, orderId: order.id, rewardId: promotion.rewardId, reason: promotion.label.slice(0, 200) } });
          }
        }
        // Müşteri gönderimi: kullanıcı yok; IP / tarayıcı bilgisi bilinçli olarak denetime YAZILMAZ (gereksiz kişisel veri).
        await tx.auditLog.create({
          data: buildAuditRow(
            {
              action: "ORDER_SUBMITTED",
              entity: "Order",
              entityId: order.id,
              tenantId: ctx.tenantId,
              userId: null,
              metadata: { source: "qr_table", actor: "customer", identified: !!customerId, promotion: promotion ? { kind: promotion.kind, discountMinor: promotion.discountMinor, pointsSpent: promotion.pointsCost } : null, orderNumber, branchId: ctx.branchId, tableId: ctx.tableId, itemCount: calc.itemCount, totalMinor: calc.subtotalMinor - discountMinor, currency: calc.currency },
            },
            { ipAddress: null, userAgent: null },
          ),
        });
        return order;
      },
      { timeout: 15_000 },
    );
    // Commit sonrası: panel / KDS canlı bildirim (müşteri kanalında henüz dinleyen yok, zararsız).
    const summary = summaryOf(created);
    publishOrderStatus({ tenantId: ctx.tenantId, orderId: created.id, orderNumber: created.orderNumber, tableName: summary.tableName, itemCount: summary.itemCount }, "SUBMITTED");
    return { kind: "created", order: summary };
  } catch (error) {
    if (error instanceof Reconcile) return { kind: "reconcile", lines: reconcileLines(error.calc), orderIssues: error.calc.orderIssues };
    if (error instanceof ContextInvalid) return { kind: "rejected", reason: "context_invalid" };
    if (error instanceof OrderingDisabled) return { kind: "rejected", reason: "feature_disabled" };
    if (error instanceof PromotionRejected) return { kind: "promotion_rejected", reason: error.reason };
    // Eşzamanlı aynı anahtar: diğer istek önce yazdı → onun siparişini dön.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await replay();
      if (again) return again;
    }
    throw error;
  }
}
