import type { Metadata } from "next";
import { Eye } from "lucide-react";
import { getMenuPageContext } from "@/server/menu-page-context";
import { MenuTabs } from "@/components/menu/menu-tabs";

export const metadata: Metadata = { title: { default: "Menü", template: "%s · Menü · MasaNova Panel" } };

export default async function MenuLayout({ children }: { children: React.ReactNode }) {
  const { canManage } = await getMenuPageContext();
  return (
    <>
      <header className="pb-2">
        <h1 className="text-title font-semibold text-fg">Menü</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Kategoriler, ürünler, fiyatlar, ekstralar, alerjenler ve çeviriler.</p>
        {!canManage ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Salt okunur görünüm — menüyü düzenleme yetkiniz yok.
          </p>
        ) : null}
      </header>
      <MenuTabs />
      {children}
    </>
  );
}
