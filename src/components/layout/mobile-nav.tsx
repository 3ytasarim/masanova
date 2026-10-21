"use client";

import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { NavArea } from "@/config/navigation";
import type { Feature } from "@/config/plans";
import type { Permission } from "@/lib/permissions/roles";
import { Dialog } from "@/components/ui/dialog";
import { SidebarNav } from "@/components/layout/sidebar-nav";

/** lg altında görünen menü düğmesi + soldan açılan çekmece (yerel <dialog>, odak hapsi dahil). */
export function MobileNav({
  area,
  permissions,
  features,
  header,
}: {
  area: NavArea;
  permissions?: readonly Permission[];
  features?: readonly Feature[];
  header: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="-ml-2 inline-flex size-11 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
        <span className="sr-only">Menüyü aç</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen} variant="sheet" title={header} className="bg-surface">
        <SidebarNav area={area} permissions={permissions} features={features} onNavigate={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
