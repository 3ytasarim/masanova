"use client";

import { Lock, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { saveLibraryItemAction } from "@/server/actions/menu.actions";
import { TranslationFields, type TranslationValues } from "@/components/menu/translation-fields";
import { Badge } from "@/components/ui/badge";
import { useFormAction } from "@/components/ui/use-form-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

type Kind = "ingredient" | "allergen" | "dietaryTag";

export type LibraryItemView = {
  id: string;
  name: string;
  displayName: string;
  active: boolean;
  system: boolean;
  usage: number;
  translations: TranslationValues;
  missingLocales: string[];
};

const KIND_COPY: Record<Kind, { title: string; add: string; help: string }> = {
  ingredient: { title: "Malzemeler", add: "Malzeme ekle", help: "Müşteriye gösterilen içerik bilgisi (ör. Domates, Cheddar, Tavuk). Tedarik/reçete maliyeti değildir." },
  allergen: { title: "Alerjenler", add: "Özel alerjen ekle", help: "AB/Türkiye 14 standart alerjeni platform tarafından sağlanır (kilitli, çevirileri hazır). Gerekirse işletmenize özel alerjen ekleyebilirsiniz." },
  dietaryTag: {
    title: "Diyet & menü etiketleri",
    add: "Özel etiket ekle",
    help: "Etiketler yalnızca işletmenin açık beyanıyla ürünlere atanır; MasaNova hiçbir etiketi otomatik çıkarmaz veya sertifika (ör. Helal) iddia etmez.",
  },
};

export function LibraryManager({ data, locales, canManage }: { data: Record<Kind, LibraryItemView[]>; locales: string[]; canManage: boolean }) {
  const [editing, setEditing] = useState<{ kind: Kind; item: LibraryItemView | null } | null>(null);
  const list = (kind: Kind) => (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-fg-subtle">{KIND_COPY[kind].help}</p>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing({ kind, item: null })}>
            <Plus aria-hidden="true" /> {KIND_COPY[kind].add}
          </Button>
        ) : null}
      </div>
      {data[kind].length === 0 ? (
        <EmptyState title="Kayıt yok" />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-bg">
          {data[kind].map((item) => (
            <li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.displayName}</span>
                {item.system ? (
                  <Badge>
                    <Lock aria-hidden="true" className="size-3" /> Standart
                  </Badge>
                ) : (
                  <Badge tone="info">Özel</Badge>
                )}
                {!item.active ? <Badge>Pasif</Badge> : null}
                {item.missingLocales.length > 0 ? <Badge tone="warning">Çeviri eksik: {item.missingLocales.join(", ").toUpperCase()}</Badge> : null}
                <span className="text-xs text-fg-subtle">{item.usage} ürün</span>
              </div>
              {canManage && !item.system ? (
                <Button variant="secondary" size="sm" onClick={() => setEditing({ kind, item })}>
                  <Pencil aria-hidden="true" /> Düzenle<span className="sr-only">: {item.displayName}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <Tabs
        label="Kütüphane"
        items={[
          { id: "allergen", label: `Alerjenler (${data.allergen.length})`, content: list("allergen") },
          { id: "dietaryTag", label: `Etiketler (${data.dietaryTag.length})`, content: list("dietaryTag") },
          { id: "ingredient", label: `Malzemeler (${data.ingredient.length})`, content: list("ingredient") },
        ]}
      />
      {editing ? <LibraryDialog key={editing.item?.id ?? `new-${editing.kind}`} kind={editing.kind} item={editing.item} locales={locales} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function LibraryDialog({ kind, item, locales, onClose }: { kind: Kind; item: LibraryItemView | null; locales: string[]; onClose: () => void }) {
  const toast = useToast();
  const action = saveLibraryItemAction.bind(null, kind, item?.id ?? null);
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) {
      toast(result.message ?? "Kaydedildi.", "success");
      onClose();
    }
    return result;
  }, null);
  const err = (k: string) => fieldError(state, k);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={item ? item.name : KIND_COPY[kind].add}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormAlert state={state} />
        <Field id="lib-name" label="Ad" required error={err("name")}>
          <Input id="lib-name" name="name" maxLength={80} defaultValue={item?.name} aria-describedby={describedBy("lib-name", { error: err("name") })} />
        </Field>
        <Checkbox id="lib-active" name="active" label="Aktif" defaultChecked={item?.active ?? true} />
        <TranslationFields idPrefix="lib-t" locales={locales} compact values={item?.translations ?? {}} errors={state && !state.ok ? state.fieldErrors : undefined} fields={[{ key: "name", label: "Ad", maxLength: 80 }]} />
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" loading={pending}>
            Kaydet
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
