/**
 * Log kırpma (saf). Yapılandırılmış loglara ASLA girmemesi gerekenler: API anahtarları, QR tokenları, konuşma kanıtları,
 * oturum kimlikleri, parolalar, ham ses, tam müşteri konuşma metni, bağlantı dizeleri.
 *
 * İki katman: (1) hassas ALAN ADLARI tamamen gizlenir; (2) serbest metindeki bilinen SIR KALIPLARI maskelenir
 * (ör. hata mesajına sızmış bir bağlantı dizesi). Döngüsel / derin nesneler sınırlanır.
 */
const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|proof|credential|dsn|database_?url|direct_?url|redis_?url|audio|transcript|utterance|content|prompt|email|phone|signature|card|cvv|cvc|^pan$|checkout|webhook_?secret)/i;

const PATTERNS: [RegExp, string][] = [
  [/sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g, "sk-***"],
  [/\b(postgres(?:ql)?|redis|rediss|mysql|mongodb(?:\+srv)?):\/\/[^\s"'@/]+@[^\s"']+/gi, "$1://***"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***"],
  // QR tokenı taşıyan yollar (/q/<token>, /t/<token>)
  [/\/(q|t)\/[A-Za-z0-9_-]{16,}/g, "/$1/<qr>"],
];

export const REDACTED = "[redacted]";

export function redactText(value: string): string {
  let out = value;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out.length > 2000 ? `${out.slice(0, 2000)}…` : out;
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), ...("code" in value && typeof value.code === "string" ? { code: value.code } : {}) };
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  if (depth >= 4) return "[depth]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1, seen);
  return out;
}
