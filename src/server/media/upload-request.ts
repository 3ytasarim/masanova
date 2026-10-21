import "server-only";
import { z } from "zod";
import { isMediaKind, MAX_UPLOAD_BYTES, MULTIPART_OVERHEAD_BYTES, type MediaKindKey } from "@/lib/media/limits";
import { PLATFORM_ORIGIN } from "@/lib/domain/get-platform-url";
import type { Permission } from "@/lib/permissions/roles";
import type { RemoveTarget, UploadTarget } from "@/server/media/media.service";

/** Logo ve kapak markanın tamamını etkiler → yalnızca branding.manage (sahip). Ürün / kategori → menu.manage. */
export const MEDIA_PERMISSION: Record<MediaKindKey, Permission> = { LOGO: "branding.manage", HERO: "branding.manage", CATEGORY: "menu.manage", PRODUCT: "menu.manage" };

export class BodyTooLarge extends Error {}

/**
 * CSRF: oturum çerezi tek (platform) origin'de; yine de değişiklik yapan istek Origin başlığı platform origin'i
 * değilse reddedilir (tarayıcı fetch POST / DELETE'te Origin'i her zaman gönderir).
 */
export function isTrustedOrigin(request: Request, platformOrigin = PLATFORM_ORIGIN): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === platformOrigin) return true;
  // Yerel geliştirme / test: aynı host'tan gelen istek (ör. 127.0.0.1 ile açılmış panel).
  const host = request.headers.get("host");
  try {
    return !!host && new URL(origin).host === host && new URL(platformOrigin).hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Gövdeyi akış hâlinde okur; sınır aşılırsa okumayı keser (sınırsız gövde YOK). Content-Length zorunlu değil ama
 * varsa ve sınırı aşıyorsa hiç okunmadan reddedilir.
 */
export async function readLimitedBody(request: Request, maxBytes = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const uploadFields = z.object({
  kind: z.string().refine(isMediaKind),
  productId: id.optional(),
  categoryId: id.optional(),
  replaceImageId: id.optional(),
  altText: z.string().trim().max(160).optional(),
});

export type ParsedUpload = { target: UploadTarget; file: File };

export function parseUploadForm(form: FormData): ParsedUpload | null {
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const parsed = uploadFields.safeParse({ kind: text("kind"), productId: text("productId"), categoryId: text("categoryId"), replaceImageId: text("replaceImageId"), altText: text("altText") });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) return null;
  const f = parsed.data;
  const kind = f.kind as MediaKindKey;
  if (kind === "PRODUCT") return f.productId ? { target: { kind, productId: f.productId, replaceImageId: f.replaceImageId ?? null, altText: f.altText ?? null }, file } : null;
  if (kind === "CATEGORY") return f.categoryId ? { target: { kind, categoryId: f.categoryId }, file } : null;
  return { target: { kind }, file };
}

const removeBody = z.object({ kind: z.string().refine(isMediaKind), productId: id.optional(), categoryId: id.optional(), imageId: id.optional() });

export function parseRemoveBody(value: unknown): RemoveTarget | null {
  const parsed = removeBody.safeParse(value);
  if (!parsed.success) return null;
  const f = parsed.data;
  const kind = f.kind as MediaKindKey;
  if (kind === "PRODUCT") return f.productId && f.imageId ? { kind, productId: f.productId, imageId: f.imageId } : null;
  if (kind === "CATEGORY") return f.categoryId ? { kind, categoryId: f.categoryId } : null;
  return { kind };
}
