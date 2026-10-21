import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { stopSupportModeAction } from "@/server/actions/tenant-admin.actions";
import { Button } from "@/components/ui/button";

/**
 * Destek modu bandı — destek modu açıkken hem panelde hem admin'de her sayfada görünür (sessiz destek yok).
 */
export function SupportBanner({ tenantName, startedAt, area }: { tenantName: string; startedAt: Date; area: "admin" | "panel" }) {
  const since = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(startedAt);
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning sm:px-6 lg:px-8">
      <LifeBuoy aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">Destek Modu</strong> — <span className="font-medium">{tenantName}</span> işletmesinin panelini salt okunur
        görüntülüyorsunuz (başlangıç {since}, en fazla 60 dk). Tüm erişim denetim kaydına yazılır.
      </p>
      <div className="flex items-center gap-2">
        {area === "admin" ? (
          <Link href="/panel" className="rounded-md px-2.5 py-1.5 font-medium underline underline-offset-4">
            Panele dön
          </Link>
        ) : null}
        <form action={stopSupportModeAction}>
          <Button type="submit" size="sm" variant="secondary">
            Destek modundan çık
          </Button>
        </form>
      </div>
    </div>
  );
}
