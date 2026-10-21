"use client";

import { ChevronDown, LogOut } from "lucide-react";
import { logoutAction } from "@/server/actions/auth.actions";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";

/** Hesap menüsü: cam hap — marka geçişli yuvarlak avatar, ad + rol, açılır ok. */
export function UserMenu({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("tr-TR");

  return (
    <Dropdown
      triggerLabel={`Hesap menüsü: ${name}`}
      triggerClassName="group flex h-11 shrink-0 items-center gap-2.5 rounded-full border border-white/80 bg-white/70 py-1 pl-1 pr-1 text-left shadow-[0_6px_18px_-12px_rgb(124_45_18/0.35)] transition-colors hover:bg-white sm:pr-3"
      trigger={
        <>
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-xs font-bold text-white shadow-[0_4px_12px_-4px_rgb(220_38_38/0.6)]">
            {initials}
          </span>
          <span className="hidden min-w-0 max-w-[12rem] flex-col sm:flex">
            <span className="truncate text-sm font-semibold leading-tight text-stone-900">{name}</span>
            <span className="truncate text-xs leading-tight text-stone-500">{roleLabel}</span>
          </span>
          <ChevronDown aria-hidden="true" className="hidden size-4 text-stone-400 transition-transform group-aria-expanded:rotate-180 sm:block" />
        </>
      }
    >
      <DropdownLabel>
        <span className="block font-medium text-fg">{name}</span>
        <span className="block truncate">{email}</span>
      </DropdownLabel>
      <DropdownSeparator />
      <form action={logoutAction}>
        <DropdownItem type="submit">
          <LogOut aria-hidden="true" />
          Çıkış yap
        </DropdownItem>
      </form>
    </Dropdown>
  );
}
