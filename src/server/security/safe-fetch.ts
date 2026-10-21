import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isPublicAddress } from "@/lib/security/ip";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";

/**
 * SSRF korumalı sunucu tarafı GET (logo vb. dış görseller).
 *
 *  - Yalnızca https, standart port (443), kimlik bilgisi içermeyen URL; IP literal ve "localhost / .local / .internal"
 *    adları reddedilir.
 *  - DNS YENİDEN BAĞLAMA (rebinding) koruması: ad, bağlantı anında ÖZEL `lookup` ile çözülür; DÖNEN TÜM adresler
 *    küresel tek-yayın olmalıdır ve soket tam olarak DOĞRULANAN adrese bağlanır (ikinci, doğrulanmamış çözümleme yok).
 *    TLS doğrulaması yine ana bilgisayar adına yapılır (SNI / sertifika değişmez).
 *  - Yönlendirme izlenmez; zaman aşımı; gövde boyutu sınırı (akış sırasında da sayılır).
 */
export class SsrfBlockedError extends Error {
  constructor(readonly reason: "scheme" | "port" | "credentials" | "host" | "address" | "dns") {
    super(`ssrf_blocked:${reason}`);
  }
}

const BLOCKED_HOSTS = /(^localhost$|\.localhost$|\.local$|\.internal$|\.home\.arpa$|^metadata(\.google\.internal)?$)/i;

/** URL ön denetimi (DNS'siz, saf). */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError("host");
  }
  if (url.protocol !== "https:") throw new SsrfBlockedError("scheme");
  if (url.port && url.port !== "443") throw new SsrfBlockedError("port");
  if (url.username || url.password) throw new SsrfBlockedError("credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || isIP(host) || BLOCKED_HOSTS.test(host) || !host.includes(".")) throw new SsrfBlockedError("host");
  return url;
}

type Resolver = (hostname: string, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
const systemResolver: Resolver = (hostname, callback) => dnsLookup(hostname, { all: true, verbatim: true }, callback);

/** Bağlantı anında çağrılan doğrulayıcı lookup: güvensiz adres varsa bağlantı hiç kurulmaz. Testlerde çözücü değiştirilebilir. */
export function createGuardedLookup(resolve: Resolver = systemResolver): LookupFunction {
  return ((hostname: string, options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error, "", 4);
      if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
        const blocked = Object.assign(new SsrfBlockedError("address"), { code: "ESSRF" }) as NodeJS.ErrnoException;
        return callback(blocked, "", 4);
      }
      const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
      if (all) return callback(null, addresses);
      const chosen = addresses[0]!;
      callback(null, chosen.address, chosen.family);
    });
  }) as LookupFunction;
}

export type SafeFetchResult = { status: number; contentType: string | null; body: Buffer };

export async function safeFetch(raw: string, options: { maxBytes: number; timeoutMs: number; accept?: string; resolver?: Resolver }): Promise<SafeFetchResult> {
  let url: URL;
  try {
    url = assertFetchableUrl(raw);
  } catch (error) {
    metrics.inc("ssrf.blocked");
    log.warn("ssrf.blocked", { code: "SSRF_BLOCKED", reason: error instanceof SsrfBlockedError ? error.reason : "unknown" });
    throw error;
  }
  return new Promise<SafeFetchResult>((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: "GET", lookup: createGuardedLookup(options.resolver), headers: { accept: options.accept ?? "*/*", "user-agent": "MasaNova/1.0 (+logo)" }, timeout: options.timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        const declared = Number(res.headers["content-length"] ?? "0");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, contentType: null, body: Buffer.alloc(0) }); // yönlendirme izlenmez
        }
        if (declared > options.maxBytes) {
          res.destroy();
          return reject(new Error("too_large"));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > options.maxBytes) {
            res.destroy();
            reject(new Error("too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, contentType: (res.headers["content-type"] as string | undefined) ?? null, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), options.timeoutMs);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error instanceof SsrfBlockedError || error.code === "ESSRF") {
        metrics.inc("ssrf.blocked");
        log.warn("ssrf.blocked", { code: "SSRF_BLOCKED", reason: "address" });
        return reject(new SsrfBlockedError("address"));
      }
      reject(error);
    });
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}
