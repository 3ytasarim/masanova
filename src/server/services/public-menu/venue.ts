import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { PublicVenue } from "@/components/public/public-menu";

/**
 * "İşletme" ve "Google Yorum" sekmeleri için yalnızca public bilgi: şube adresi, harita bağlantısı, çalışma saatleri.
 * Google yorum bağlantısı yoksa haritadaki işletme araması açılır.
 */
export async function loadVenue(tenantId: string, branchId: string | null, name: string, reviewUrl: string | null): Promise<PublicVenue> {
  const [branch, hours] = await Promise.all([
    branchId ? prisma.branch.findFirst({ where: { id: branchId, tenantId }, select: { address: true, district: true, city: true } }) : null,
    branchId ? prisma.branchOpeningHours.findMany({ where: { tenantId, branchId }, orderBy: [{ weekday: "asc" }, { opensMinute: "asc" }], select: { weekday: true, opensMinute: true, closesMinute: true } }) : [],
  ]);
  // İlçe / il adreste zaten geçiyorsa tekrar eklenmez.
  const lower = (branch?.address ?? "").toLocaleLowerCase("tr-TR");
  const locality = [branch?.district, branch?.city].filter((x): x is string => !!x && !lower.includes(x.toLocaleLowerCase("tr-TR")));
  const address = [branch?.address, locality.join(" / ")].filter(Boolean).join(", ") || null;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(" "))}`;
  return { address, mapUrl, reviewUrl: reviewUrl ?? mapUrl, hours: hours.map((h) => ({ weekday: h.weekday, opens: h.opensMinute, closes: h.closesMinute })) };
}
