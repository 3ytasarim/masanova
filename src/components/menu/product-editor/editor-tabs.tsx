"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";

/**
 * Ürün editörü sekmeleri. Etkin sekme URL'de (?sekme=) tutulur: kayıt sonrası yenilemede ve paylaşılan
 * bağlantıda aynı sekme açılır. İçerikler sunucuda hazırlanır; her sekme kendi formunu bağımsız kaydeder.
 */
export function EditorTabs({ items, defaultTab }: { items: { id: string; label: ReactNode; content: ReactNode }[]; defaultTab: string }) {
  return (
    <Tabs
      label="Ürün düzenleme bölümleri"
      items={items}
      defaultTab={defaultTab}
      onChange={(id) => {
        const url = new URL(window.location.href);
        url.searchParams.set("sekme", id);
        window.history.replaceState(window.history.state, "", url);
      }}
    />
  );
}
