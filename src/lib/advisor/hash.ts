import { createHash } from "node:crypto";
import type { InsightCandidate } from "@/lib/advisor/types";

/** Kararlı JSON (anahtarlar sıralı) — aynı olgular her zaman aynı özeti verir. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** Olgu özeti: değişmediyse önceki AI açıklaması YENİDEN kullanılır (tekrar ücretli istek yok). */
export function factHash(c: Pick<InsightCandidate, "type" | "subjectKey" | "facts">): string {
  return createHash("sha256").update(stableStringify({ t: c.type, s: c.subjectKey, f: c.facts })).digest("hex").slice(0, 32);
}

/**
 * Önemli değişim imzası: yön + kaba büyüklük kovası + güven. Kapatılan içgörü yalnızca imza değişirse (ör. yön döndü,
 * büyüklük bir kova atladı) yeniden "yeni" olur; küçük dalgalanma kapatmayı bozmaz.
 */
export function materialSignature(c: Pick<InsightCandidate, "type" | "subjectKey" | "facts" | "confidence">): string {
  const f = c.facts;
  const magnitude = ["deltaPct", "deltaPp", "gapPct", "sharePct", "robustZ", "ratio", "qtySharePct", "ratePct"].map((k) => f[k]).find((v) => typeof v === "number") as number | undefined;
  const direction = magnitude === undefined ? "n" : magnitude >= 0 ? "u" : "d";
  const bucket = magnitude === undefined ? 0 : Math.floor(Math.log2(1 + Math.abs(magnitude) / 10));
  return createHash("sha256").update(stableStringify({ t: c.type, s: c.subjectKey, d: direction, b: bucket, c: c.confidence })).digest("hex").slice(0, 16);
}
