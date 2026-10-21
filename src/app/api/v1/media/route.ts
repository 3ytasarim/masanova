import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/auth/guards";
import { MEDIA_ERROR_MESSAGES, MEDIA_RULES, tooLargeMessage, type MediaErrorCode } from "@/lib/media/limits";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { hasPermission } from "@/lib/permissions/roles";
import { getRequestMeta } from "@/lib/security/request-meta";
import { removeMedia, uploadMedia, type MediaActor } from "@/server/media/media.service";
import { BodyTooLarge, isTrustedOrigin, MEDIA_PERMISSION, parseRemoveBody, parseUploadForm, readLimitedBody } from "@/server/media/upload-request";
import { rateLimit } from "@/server/rate-limit";
import { invalidatePublicMenu } from "@/server/services/public-menu/public-menu-cache";

/**
 * Panel görsel yükleme API'si (Sprint 13).
 *   POST   /api/v1/media  multipart: kind=PRODUCT|CATEGORY|HERO|LOGO, file, productId / categoryId / replaceImageId
 *   DELETE /api/v1/media  JSON: { kind, productId, imageId } | { kind, categoryId } | { kind: "HERO" | "LOGO" }
 *
 * - Kiracı OTURUMDAN (requireTenantUser, write: true → Super Admin destek modu REDDEDİLİR, 404).
 * - Yetki türe göre: logo / kapak = branding.manage (sahip); ürün / kategori = menu.manage (sahip, şube müdürü).
 * - Origin platform origin'i olmalı (CSRF). Gövde akış hâlinde ve sınırlı okunur (proxy bu yolu tamponlamaz —
 *   bkz. src/proxy.ts matcher).
 * - Yanıt ASLA dosya sistemi yolu / istisna metni içermez.
 */
export const dynamic = "force-dynamic";

const STATUS: Record<MediaErrorCode, number> = { unsupported: 415, too_large: 413, dimensions: 422, animated: 422, processing_failed: 422, not_found: 404, limit: 409, storage_limit: 403, failed: 500 };

function fail(code: MediaErrorCode, message: string = MEDIA_ERROR_MESSAGES[code]) {
  return NextResponse.json({ ok: false, code, error: message }, { status: STATUS[code], headers: { "Cache-Control": "no-store" } });
}

async function actorFor(kind: keyof typeof MEDIA_PERMISSION): Promise<MediaActor | null> {
  const ctx = await requireTenantUser({ write: true });
  if (!hasPermission(ctx.user.role, MEDIA_PERMISSION[kind])) return null;
  return { userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() };
}

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "Geçersiz istek kaynağı." }, { status: 403 });
  // Oturum + destek modu denetimi gövde okunmadan önce (yetkisiz istek büyük gövdeyi işletemez).
  const session = await requireTenantUser({ write: true });

  let form: FormData;
  try {
    const body = await readLimitedBody(request);
    form = await new Response(new Uint8Array(body), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch (error) {
    if (error instanceof BodyTooLarge) return fail("too_large");
    return fail("unsupported");
  }
  const parsed = parseUploadForm(form);
  if (!parsed) return fail("unsupported", "Geçersiz yükleme isteği.");
  const { target, file } = parsed;

  const actor = await actorFor(target.kind);
  if (!actor) return NextResponse.json({ ok: false, error: "Bulunamadı." }, { status: 404 });
  if (file.size > MEDIA_RULES[target.kind].maxBytes) return fail("too_large", tooLargeMessage(target.kind));

  const limited = await rateLimit("media.upload", session.user.id);
  if (!limited.allowed) {
    return NextResponse.json({ ok: false, error: "Çok fazla yükleme. Biraz sonra tekrar deneyin." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  const started = Date.now();
  const result = await uploadMedia(actor, target, Buffer.from(await file.arrayBuffer()));
  if (!result.ok) {
    metrics.inc("media.upload_rejected", 1, result.error);
    return fail(result.error, result.error === "too_large" ? tooLargeMessage(target.kind) : undefined);
  }
  invalidatePublicMenu(actor.scope.tenantId, "other");
  metrics.inc("media.uploaded", 1, target.kind);
  log.info("media.uploaded", { tenant: actor.scope.tenantId, kind: target.kind, replaced: result.data.replaced, ms: Date.now() - started });
  return NextResponse.json({ ok: true, assetId: result.data.assetId, url: result.data.image?.url ?? null, replaced: result.data.replaced }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "Geçersiz istek kaynağı." }, { status: 403 });
  await requireTenantUser({ write: true });
  let json: unknown;
  try {
    json = JSON.parse((await readLimitedBody(request, 4096)).toString("utf8"));
  } catch {
    return fail("unsupported", "Geçersiz istek.");
  }
  const target = parseRemoveBody(json);
  if (!target) return fail("unsupported", "Geçersiz istek.");
  const actor = await actorFor(target.kind);
  if (!actor) return NextResponse.json({ ok: false, error: "Bulunamadı." }, { status: 404 });
  const result = await removeMedia(actor, target);
  if (!result.ok) return fail(result.error);
  invalidatePublicMenu(actor.scope.tenantId, "other");
  return NextResponse.json({ ok: true, removed: result.data.removed }, { headers: { "Cache-Control": "no-store" } });
}
