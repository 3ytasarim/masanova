"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { logoutAction } from "@/server/actions/auth.actions";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";

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
      triggerClassName="flex h-11 items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-surface-2 sm:pr-2.5"
      trigger={
        <>
          <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-fg">
            {initials}
          </span>
          <span className="hidden min-w-0 flex-col sm:flex">
            <span className="truncate text-sm font-medium leading-tight text-fg">{name}</span>
            <span className="truncate text-xs leading-tight text-fg-subtle">{roleLabel}</span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="hidden size-4 text-fg-subtle sm:block" />
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
