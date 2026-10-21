import type { NextRequest } from "next/server";
import { labelOptionsSchema, paramsToRecord, tableIdSchema } from "@/lib/validation/tables";
import { downloadActor, errorResponse, fileName, fileResponse } from "@/server/labels/http";
import { buildTableLabel, labelPdf, labelSvg } from "@/server/services/tables/label.service";

/**
 * Tek masa etiketi: GET /panel/masalar/indir/etiket?masa=<id>&bicim=pdf|svg|onizleme&sablon=…&boyut=…
 * "onizleme": düzenleyicinin canlı önizlemesi (satır içi SVG, denetim kaydı yok). Uyarılar ve QR boyutu
 * `X-Label-Info` başlığında (JSON, URI kodlu) döner. PDF indirmesi denetim kaydına yazılır.
 */
export async function GET(request: NextRequest) {
  const actor = await downloadActor();
  const params = request.nextUrl.searchParams;
  const id = tableIdSchema.safeParse(params.get("masa"));
  if (!id.success) return errorResponse(404, "Masa bulunamadı.");
  const options = labelOptionsSchema.safeParse(paramsToRecord(params));
  if (!options.success) return errorResponse(400, options.error.issues[0]?.message ?? "Geçersiz etiket seçenekleri.");

  const label = await buildTableLabel(actor.scope, id.data, options.data);
  if (!label.ok) return errorResponse(label.status, label.error);
  const { drawing } = label;
  const info = encodeURIComponent(JSON.stringify({ warnings: drawing.warnings, qrMm: Math.round(drawing.qr.sizeMm * 10) / 10, forced: drawing.qr.colorsForced }));
  const base = `${drawing.title.split(" — ").at(-1) ?? "masa"}-etiket-${options.data.template}-${options.data.width}x${options.data.height}`;

  switch (params.get("bicim")) {
    case "pdf":
      return fileResponse(new Uint8Array(await labelPdf(actor, id.data, options.data, drawing)), "application/pdf", fileName(base, "pdf"));
    case "svg":
      return fileResponse(labelSvg(drawing), "image/svg+xml; charset=utf-8", fileName(base, "svg"));
    default:
      return fileResponse(labelSvg(drawing), "image/svg+xml; charset=utf-8", fileName(base, "svg"), true, { "X-Label-Info": info });
  }
}
