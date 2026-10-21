"use client";

import { Info, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";

/** Tasarım sistemi sayfasındaki etkileşimli örnekler (Dialog, Dropdown, Tooltip, Tabs). */
export function UiKitInteractive() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Dialog aç
        </Button>
        <Dropdown
          triggerLabel="Satır işlemleri"
          triggerClassName="inline-flex size-11 items-center justify-center rounded-md border border-border-strong bg-bg hover:bg-surface"
          trigger={<MoreHorizontal aria-hidden="true" className="size-4" />}
        >
          <DropdownItem>
            <Pencil aria-hidden="true" /> Düzenle
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem className="text-danger hover:text-danger focus-visible:text-danger">
            <Trash2 aria-hidden="true" /> Sil
          </DropdownItem>
        </Dropdown>
        <Tooltip content="Masa numarası QR kodun içine gömülür.">
          <button type="button" className="inline-flex size-11 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg">
            <Info aria-hidden="true" className="size-4" />
            <span className="sr-only">Bilgi</span>
          </button>
        </Tooltip>
      </div>

      <Tabs
        label="Örnek sekmeler"
        items={[
          { id: "genel", label: "Genel", content: <p className="text-sm text-fg-muted">Sekme içeriği: işletme genel bilgileri.</p> },
          { id: "subeler", label: "Şubeler", content: <p className="text-sm text-fg-muted">Sekme içeriği: şube listesi.</p> },
          { id: "domain", label: "Alan adları", content: <p className="text-sm text-fg-muted">Sekme içeriği: alan adları.</p> },
        ]}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Şube adını düzenle"
        description="Bu örnek dialog yalnızca tasarım sistemini göstermek içindir; kayıt yapmaz."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => setDialogOpen(false)}>Tamam</Button>
          </>
        }
      >
        <Field id="ui-kit-branch-name" label="Şube adı">
          <Input id="ui-kit-branch-name" defaultValue="Merkez Şube" />
        </Field>
      </Dialog>
    </div>
  );
}
