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
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/80 bg-white/70 text-stone-700 hover:bg-white lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
        <span className="sr-only">Menüyü aç</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen} variant="sheet" title={header} className="mn-shell-bg">
        <SidebarNav area={area} permissions={permissions} features={features} onNavigate={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
