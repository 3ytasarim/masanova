/**
 * İstek gövdesi sınırları — büyük gövde ERKEN reddedilir (Content-Length yalan söylese / hiç olmasa da akış okunurken
 * sayılır; sınır aşılınca okuma kesilir). Rota başına üst sınırlar tek yerde.
 */
export const BODY_LIMITS = {
  /** AI oturum / rapor / ses isteği gibi küçük JSON gövdeleri. */
  smallJson: 16 * 1024,
  /** AI yazılı tur + sepet bağlamı. */
  aiTurnJson: 64 * 1024,
  /** JSON içinde base64 ses (≤ 3 MB ses ≈ 4 MB base64) + bağlam. */
  audioJson: Math.ceil((3 * 1024 * 1024 * 4) / 3) + 128 * 1024,
  /** Etiket PDF sayfa isteği (masa listesi). */
  labelsJson: 256 * 1024,
} as const;

export class BodyTooLargeError extends Error {
  constructor() {
    super("body_too_large");
  }
}

/** Gövdeyi en fazla `maxBytes` okuyarak metin döndür; aşarsa BodyTooLargeError. */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

/** JSON gövde: sınır aşımı → "too_large", bozuk JSON → "invalid". */
export async function readJsonBody(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; error: "too_large" | "invalid" }> {
  let text: string;
  try {
    text = await readBodyText(request, maxBytes);
  } catch (error) {
    return { ok: false, error: error instanceof BodyTooLargeError ? "too_large" : "invalid" };
  }
  try {
    return { ok: true, value: text ? (JSON.parse(text) as unknown) : null };
  } catch {
    return { ok: false, error: "invalid" };
  }
}
