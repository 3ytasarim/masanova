import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { tableIdSchema } from "@/lib/validation/tables";
import { downloadActor, errorResponse, fileName, fileResponse } from "@/server/labels/http";
import { qrPng, qrSvg } from "@/server/labels/qr";
import { REVEAL_FAILURE_MESSAGES, revealTableQr } from "@/server/services/tables/qr.service";

/**
 * Yalnızca QR kodu: GET /panel/masalar/indir/qr?masa=<id>&bicim=svg|png[&gorunum=1]
 * Masa kimliği yalnızca oturumdaki kiracının kapsamında aranır; başka kiracının masası 404.
 */
export async function GET(request: NextRequest) {
  const actor = await downloadActor();
  const params = request.nextUrl.searchParams;
  const id = tableIdSchema.safeParse(params.get("masa"));
  const format = params.get("bicim") === "png" ? "png" : "svg";
  if (!id.success) return errorResponse(404, "Masa bulunamadı.");

  const revealed = await revealTableQr(actor.scope, id.data);
  if (!revealed.ok) return errorResponse(revealed.reason === "no_table" ? 404 : 409, REVEAL_FAILURE_MESSAGES[revealed.reason]);
  const table = await prisma.diningTable.findFirst({ where: { id: id.data, tenantId: actor.scope.tenantId }, select: { name: true } });
  const base = `${table?.name ?? "masa"}-qr`;
  const inline = params.get("gorunum") === "1";

  if (format === "png") return fileResponse(new Uint8Array(await qrPng(revealed.qr.url)), "image/png", fileName(base, "png"), inline);
  return fileResponse(qrSvg(revealed.qr.url, `${table?.name ?? "Masa"} QR kodu`), "image/svg+xml; charset=utf-8", fileName(base, "svg"), inline);
}
