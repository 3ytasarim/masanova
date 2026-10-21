import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTenantUrl } from "@/lib/domain/get-tenant-url";
import { rateLimit } from "@/server/rate-limit";
import { getRequestMeta } from "@/lib/security/request-meta";
import { resolveStableQrEntry } from "@/lib/tables/resolve-stable-entry";
import { stableEntryLookup } from "@/server/repositories/table-qr.repository";

/**
 * Kararlı QR girişi: <QR_ENTRY_ORIGIN>/q/<token> → kiracının O ANKİ alan adındaki /t/<token> (307, önbelleğe alınmaz).
 * - Okutma burada SAYILMAZ (kanonik olay /t sayfasıdır; bkz. src/lib/tables/scan-count.ts) → bir okutma = bir sayım.
 * - Başarısızlıkların hepsi aynı nötr 404 sayfasıdır; IP başına hız sınırı kaba deneme taramasını keser.
 * - Token hiçbir yere loglanmaz.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MasaNova QR", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function StableQrEntryPage({ params }: { params: Promise<{ token: string }> }) {
  const { ipAddress } = await getRequestMeta();
  if (!(await rateLimit("qr.entry", ipAddress ?? "unknown")).allowed) notFound();

  const result = await resolveStableQrEntry({ token: (await params).token }, { lookup: stableEntryLookup });
  if (!result.ok) notFound();
  redirect(getTenantUrl(result.hostname, result.path));
}
