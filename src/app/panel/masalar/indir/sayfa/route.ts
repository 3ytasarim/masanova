import type { NextRequest } from "next/server";
import { BODY_LIMITS } from "@/lib/security/body";
import { PLATFORM_ORIGIN } from "@/lib/domain/get-platform-url";
import { labelOptionsSchema, paramsToRecord, sheetTargetSchema } from "@/lib/validation/tables";
import { downloadActor, errorResponse, fileName, fileResponse } from "@/server/labels/http";
import { buildSheetPdf } from "@/server/services/tables/label.service";

/**
 * A4 toplu etiket sayfası: POST /panel/masalar/indir/sayfa (form gönderimi → PDF dosyası).
 * Seçili masa listesi uzun olabileceğinden POST. Route Handler'lar Server Action CSRF korumasını almadığı için
 * Origin başlığı platform origin'iyle eşleşmek zorunda (oturum çerezi SameSite=Lax ayrıca korur).
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== PLATFORM_ORIGIN && origin !== request.nextUrl.origin) return errorResponse(403, "Geçersiz istek kaynağı.");
  const actor = await downloadActor();

  const length = Number(request.headers.get("content-length") ?? "");
  if (!Number.isFinite(length) || length <= 0 || length > BODY_LIMITS.labelsJson) return errorResponse(413, "İstek çok büyük.");
  const form = await request.formData();
  const record = paramsToRecord(form);
  const target = sheetTargetSchema.safeParse({ kapsam: record.kapsam, sube: record.sube, bolge: record.bolge, masalar: form.getAll("masalar") });
  if (!target.success) return errorResponse(400, target.error.issues[0]?.message ?? "Geçersiz seçim.");
  const options = labelOptionsSchema.safeParse(record);
  if (!options.success) return errorResponse(400, options.error.issues[0]?.message ?? "Geçersiz etiket seçenekleri.");

  const result = await buildSheetPdf(actor, target.data, options.data);
  if (!result.ok) return errorResponse(result.status, result.error);
  return fileResponse(new Uint8Array(result.pdf), "application/pdf", fileName(`qr-etiketleri-a4-${options.data.width}x${options.data.height}`, "pdf"), false, {
    "X-Labels-Printed": String(result.printed),
    "X-Labels-Skipped": String(result.skipped),
  });
}
