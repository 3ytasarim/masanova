import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminNav, findNavItem } from "@/config/navigation";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { ComingSoon } from "@/components/dashboard/coming-soon";

type Props = { params: Promise<{ section: string }> };

/**
 * Bölüm listesi sabit: bilinmeyen segmentler render başlamadan 404 olur (yükleme sınırı içinde
 * notFound() çağrılıp 200 dönen "soft 404" oluşmaz).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return adminNav.filter((item) => item.segment && item.sprint).map((item) => ({ section: item.segment }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = findNavItem("admin", (await params).section);
  return { title: item?.label ?? "Bulunamadı" };
}

/** Henüz geliştirilmemiş admin bölümleri. Gerçek sayfalar (sistem, audit-logs) kendi klasörlerinde. */
export default async function AdminSectionPage({ params }: Props) {
  await requireSuperAdmin();
  const item = findNavItem("admin", (await params).section);
  if (!item || !item.segment || !item.sprint) notFound();
  return <ComingSoon item={item} />;
}
