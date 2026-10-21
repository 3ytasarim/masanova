import type { Metadata } from "next";
import { Eye } from "lucide-react";
import { getTablesPageContext } from "@/server/tables-page-context";
import { TablesTabs } from "@/components/tables/tables-tabs";

export const metadata: Metadata = { title: { default: "Masalar & QR", template: "%s · Masalar · MasaNova Panel" } };

export default async function TablesLayout({ children }: { children: React.ReactNode }) {
  const { canManage } = await getTablesPageContext();
  return (
    <>
      <header className="pb-2">
        <h1 className="text-title font-semibold text-fg">Masalar & QR</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Bölgeler, masalar, güvenli QR kodları ve baskıya hazır etiketler.</p>
        {!canManage ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Salt okunur görünüm — masaları ve QR kodlarını yönetme yetkiniz yok.
          </p>
        ) : null}
      </header>
      <TablesTabs showLabels={canManage} />
      {children}
    </>
  );
}
