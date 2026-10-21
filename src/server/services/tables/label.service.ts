import "server-only";
import { prisma } from "@/lib/db/prisma";
import { A4_MM, computeSheetLayout, type SheetLayout } from "@/lib/tables/label-geometry";
import type { LabelOptions } from "@/lib/tables/label-options";
import type { TenantScope } from "@/lib/tenant/scope";
import type { SheetTarget } from "@/lib/validation/tables";
import { buildLabel, type LabelBrand, type LabelDrawing } from "@/server/labels/layout";
import { loadLogo, loadManagedLogo } from "@/server/labels/logo";
import { MEDIA_ASSET_SELECT } from "@/server/media/urls";
import { renderLabelPdf, renderLabelSvg, renderSheetPdf } from "@/server/labels/render";
import { REVEAL_FAILURE_MESSAGES, revealTableQr, revealTablesQr } from "@/server/services/tables/qr.service";
import { tablesAudit, type TablesActor } from "@/server/services/tables/tables-common";

/**
 * QR etiket üretimi. Etiket her zaman kiracının KENDİ masası ve etkin QR adresiyle çizilir; masa kimliği
 * kapsam içinde aranır (tahmin edilen kimlikle başka kiracının etiketi indirilemez).
 */

/** Toplu sayfada en fazla etiket (≈ 40 A4 sayfa). */
export const SHEET_MAX_LABELS = 500;

export async function getLabelBrand(scope: TenantScope, withLogo: boolean): Promise<LabelBrand> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: scope.tenantId },
    select: { name: true, settings: { select: { logoUrl: true, logoAsset: { select: MEDIA_ASSET_SELECT }, primaryColor: true, secondaryColor: true, accentColor: true } } },
  });
  // Yüklenen logo diskten okunur (ağ isteği yok); yoksa harici adres SSRF korumalı indirilir.
  const managed = tenant.settings?.logoAsset ?? null;
  const logo = !withLogo ? { image: null, failed: false } : managed ? await loadManagedLogo(managed) : await loadLogo(tenant.settings?.logoUrl);
  return {
    name: tenant.name,
    primary: tenant.settings?.primaryColor ?? null,
    secondary: tenant.settings?.secondaryColor ?? null,
    accent: tenant.settings?.accentColor ?? null,
    logo: logo.image,
    logoFailed: logo.failed,
  };
}

export type LabelResult = { ok: true; drawing: LabelDrawing } | { ok: false; error: string; status: 404 | 409 };

/** Tek masa etiketi (önizleme ve indirme ortak). */
export async function buildTableLabel(scope: TenantScope, tableId: string, options: LabelOptions): Promise<LabelResult> {
  const table = await prisma.diningTable.findFirst({ where: { id: tableId, tenantId: scope.tenantId }, select: { name: true } });
  if (!table) return { ok: false, error: "Masa bulunamadı.", status: 404 };
  const revealed = await revealTableQr(scope, tableId);
  if (!revealed.ok) return { ok: false, error: REVEAL_FAILURE_MESSAGES[revealed.reason], status: revealed.reason === "no_table" ? 404 : 409 };
  const brand = await getLabelBrand(scope, options.showLogo);
  return { ok: true, drawing: buildLabel(options, brand, { tableName: table.name, url: revealed.qr.url }) };
}

export function labelSvg(drawing: LabelDrawing): string {
  return renderLabelSvg(drawing);
}

export async function labelPdf(actor: TablesActor, tableId: string, options: LabelOptions, drawing: LabelDrawing): Promise<Uint8Array> {
  const pdf = await renderLabelPdf(drawing);
  await prisma.auditLog.create({
    data: tablesAudit(actor, { action: "LABEL_PDF_GENERATED", entity: "DiningTable", entityId: tableId, metadata: { kind: "single", template: options.template, widthMm: options.width, heightMm: options.height, bleed: options.bleed } }),
  });
  return pdf;
}

/** Toplu baskı hedefindeki masalar (kapsam içinde) + etkin QR'ı olmayanlar. */
export async function resolveSheetTables(scope: TenantScope, target: SheetTarget) {
  const branch = await prisma.branch.findFirst({ where: { id: target.sube, tenantId: scope.tenantId }, select: { id: true } });
  if (!branch) return null;
  const tables = await prisma.diningTable.findMany({
    where: {
      tenantId: scope.tenantId,
      branchId: branch.id,
      ...(target.kapsam === "bolge" ? { diningAreaId: target.bolge } : target.kapsam === "secili" ? { id: { in: target.masalar } } : {}),
    },
    orderBy: [{ area: { sortOrder: "asc" } }, { sortOrder: "asc" }, { number: "asc" }, { name: "asc" }],
    take: SHEET_MAX_LABELS + 1,
    select: { id: true, name: true },
  });
  return tables;
}

export type SheetResult =
  | { ok: true; pdf: Uint8Array; layout: SheetLayout; printed: number; skipped: number }
  | { ok: false; error: string; status: 400 | 404 | 409 };

export async function buildSheetPdf(actor: TablesActor, target: SheetTarget, options: LabelOptions): Promise<SheetResult> {
  const tables = await resolveSheetTables(actor.scope, target);
  if (!tables) return { ok: false, error: "Şube bulunamadı.", status: 404 };
  if (tables.length === 0) return { ok: false, error: "Seçime uyan masa yok.", status: 404 };
  if (tables.length > SHEET_MAX_LABELS) return { ok: false, error: `Tek seferde en fazla ${SHEET_MAX_LABELS} etiket basılabilir; bölge bazında bölün.`, status: 400 };

  // A4 sayfada taşma payı uygulanmaz (kesim işaretleri eklenir).
  const sheetOptions: LabelOptions = { ...options, bleed: false };
  const layout = computeSheetLayout({ width: sheetOptions.width, height: sheetOptions.height }, tables.length);
  if (layout.perPage === 0) return { ok: false, error: layout.warning ?? "Etiket sayfaya sığmıyor.", status: 400 };

  const urls = await revealTablesQr(actor.scope, tables.map((t) => t.id));
  const printable = tables.filter((t) => urls.has(t.id));
  if (printable.length === 0) return { ok: false, error: "Seçili masaların hiçbirinde etkin QR kodu yok. Önce QR kodlarını oluşturun.", status: 409 };

  const brand = await getLabelBrand(actor.scope, sheetOptions.showLogo);
  const drawings = printable.map((t) => buildLabel(sheetOptions, brand, { tableName: t.name, url: urls.get(t.id)! }));
  const finalLayout = computeSheetLayout({ width: sheetOptions.width, height: sheetOptions.height }, printable.length);
  const pdf = await renderSheetPdf(drawings, finalLayout, A4_MM, `${brand.name} — QR etiketleri`);
  await prisma.auditLog.create({
    data: tablesAudit(actor, {
      action: "LABEL_PDF_GENERATED",
      entity: "DiningTable",
      entityId: null,
      metadata: { kind: "sheet", scope: target.kapsam, branchId: target.sube, labels: printable.length, skipped: tables.length - printable.length, pages: finalLayout.pages, template: options.template, widthMm: options.width, heightMm: options.height },
    }),
  });
  return { ok: true, pdf, layout: finalLayout, printed: printable.length, skipped: tables.length - printable.length };
}
