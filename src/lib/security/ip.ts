import { isIP } from "node:net";

/**
 * Sunucu tarafı dış istekler için adres sınıflandırması (saf). Yalnızca KÜRESEL tek-yayın (public unicast) adreslere
 * izin verilir; geri döngü, özel ağ (RFC 1918), bağlantı-yerel, paylaşımlı CGNAT, bulut meta veri (169.254.169.254),
 * belgeleme / kıyaslama blokları, çok noktaya yayın ve ayrılmış aralıklar reddedilir. IPv6'da ULA, bağlantı-yerel,
 * site-yerel, çok noktaya yayın, IPv4-eşlemeli / NAT64 / 6to4 içindeki gömülü IPv4 de denetlenir.
 */
type V4 = [number, number, number, number];

function parseV4(address: string): V4 | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? (nums as V4) : null;
}

function v4Blocked([a, b, c]: V4): boolean {
  return (
    a === 0 || // "bu ağ"
    a === 10 || // RFC 1918
    a === 127 || // geri döngü
    (a === 100 && b >= 64 && b <= 127) || // CGNAT (RFC 6598)
    (a === 169 && b === 254) || // bağlantı-yerel + bulut meta veri
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF / TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 aktarım
    (a === 192 && b === 168) || // RFC 1918
    (a === 198 && (b === 18 || b === 19)) || // kıyaslama
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // çok noktaya yayın + ayrılmış + yayın
  );
}

/** IPv6 adresini 8 × 16 bitlik diziye aç (gömülü IPv4 ve :: dahil). Geçersizse null. */
export function parseV6(input: string): number[] | null {
  let address = input.toLowerCase();
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  // Gömülü IPv4 ("::ffff:10.0.0.1") → iki onaltılık grup
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (!v4) return null;
    address = `${address.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const toNums = (part: string) => (part ? part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = toNums(halves[0]!);
  const rest = halves.length === 2 ? toNums(halves[1]!) : [];
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else groups = head;
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g))) return null;
  return groups;
}

function embeddedV4(hi: number, lo: number): V4 {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function v6Blocked(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zeroPrefix && g5 === 0) return true; // ::, ::1, IPv4-uyumlu (::a.b.c.d — kullanımdan kalktı)
  if (zeroPrefix && g5 === 0xffff) return v4Blocked(embeddedV4(g6, g7)); // ::ffff:a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4Blocked(embeddedV4(g6, g7)); // NAT64
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true; // yerel NAT64
  if (g0 === 0x2002) return v4Blocked(embeddedV4(g1, g2)); // 6to4
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // atma öneki
  if (g0 === 0x2001 && g1 < 0x0200) return true; // IETF protokol atamaları (Teredo vb.)
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // belgeleme
  if ((g0 & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // bağlantı-yerel
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-yerel (eski)
  if ((g0 & 0xff00) === 0xff00) return true; // çok noktaya yayın
  return (g0 & 0xe000) !== 0x2000; // yalnızca 2000::/3 küresel tek-yayın
}

/** Adres dış istek için GÜVENLİ mi (küresel tek-yayın)? Ayrıştırılamayan her şey güvensizdir. */
export function isPublicAddress(address: string): boolean {
  const clean = address.replace(/^\[|\]$/g, "");
  const kind = isIP(clean.split("%")[0]!);
  if (kind === 4) {
    const v4 = parseV4(clean);
    return !!v4 && !v4Blocked(v4);
  }
  if (kind === 6) {
    const groups = parseV6(clean);
    return !!groups && !v6Blocked(groups);
  }
  return false;
}
