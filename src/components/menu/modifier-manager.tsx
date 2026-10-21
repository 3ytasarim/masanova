"use client";

import { ArrowDown, ArrowUp, Archive, ListPlus, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { modifierGroupQuickAction, modifierQuickAction, saveModifierAction, saveModifierGroupAction } from "@/server/actions/menu.actions";
import { QuickAction } from "@/components/menu/quick-action";
import { TranslationFields, type TranslationValues } from "@/components/menu/translation-fields";
import { Badge } from "@/components/ui/badge";
import { useFormAction } from "@/components/ui/use-form-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export type ModifierView = { id: string; name: string; priceDelta: string; priceLabel: string; active: boolean; translations: TranslationValues };
export type GroupView = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  productCount: number;
  translations: TranslationValues;
  modifiers: ModifierView[];
};

type Editing = { kind: "group"; group: GroupView | null } | { kind: "modifier"; groupId: string; modifier: ModifierView | null } | null;

export function ModifierManager({ groups, locales, canManage }: { groups: GroupView[]; locales: string[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-subtle">
          Ekstra grupları yeniden kullanılabilir: “İçecek Seçimi” birçok menüye bağlanabilir. Zorunlu grupta en az 1 seçim gerekir; fiyat farkı 0 veya pozitif olabilir.
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing({ kind: "group", group: null })}>
            <Plus aria-hidden="true" /> Yeni grup
          </Button>
        ) : null}
      </div>
      {groups.length === 0 ? (
        <EmptyState icon={ListPlus} title="Henüz ekstra grubu yok" description="Ör. Pişirme Derecesi, Ekstra Malzemeler, İçecek Seçimi." />
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id} className="rounded-lg border border-border bg-bg">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{g.name}</h3>
                    <Badge tone={g.required ? "warning" : "neutral"}>{g.required ? "Zorunlu" : "İsteğe bağlı"}</Badge>
                    {!g.active ? <Badge>Pasif</Badge> : null}
                  </div>
                  <p className="text-xs text-fg-subtle">
                    {g.minSelect}–{g.maxSelect} seçim · {g.productCount} üründe kullanılıyor
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-1">
                    <Button variant="secondary" size="sm" onClick={() => setEditing({ kind: "group", group: g })}>
                      <Pencil aria-hidden="true" /> Düzenle<span className="sr-only">: {g.name}</span>
                    </Button>
                    <ConfirmDialog
                      action={modifierGroupQuickAction}
                      hidden={{ groupId: g.id, op: "archive" }}
                      triggerLabel={
                        <>
                          <Archive aria-hidden="true" /> Arşivle
                        </>
                      }
                      triggerVariant="ghost"
                      title={`${g.name} arşivlensin mi?`}
                      description={`Grup ${g.productCount} üründen görünmez olur; kayıtlar korunur (gelecekteki sipariş geçmişi için).`}
                      confirmLabel="Arşivle"
                      destructive
                    />
                  </div>
                ) : null}
              </div>
              {g.modifiers.length === 0 ? (
                <p className="px-4 py-3 text-sm text-fg-subtle">Bu grupta henüz seçenek yok.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {g.modifiers.map((m, i) => (
                    <li key={m.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{m.name}</span>
                        <span className="tabular-nums text-fg-muted">{m.priceLabel}</span>
                        {!m.active ? <Badge>Pasif</Badge> : null}
                      </div>
                      {canManage ? (
                        <div className="flex items-center gap-0.5">
                          <QuickAction action={modifierQuickAction.bind(null, g.id)} fields={{ modifierId: m.id, op: "up" }} label={`${m.name}: yukarı`} disabled={i === 0}>
                            <ArrowUp aria-hidden="true" />
                          </QuickAction>
                          <QuickAction action={modifierQuickAction.bind(null, g.id)} fields={{ modifierId: m.id, op: "down" }} label={`${m.name}: aşağı`} disabled={i === g.modifiers.length - 1}>
                            <ArrowDown aria-hidden="true" />
                          </QuickAction>
                          <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: "modifier", groupId: g.id, modifier: m })}>
                            Düzenle<span className="sr-only">: {m.name}</span>
                          </Button>
                          <QuickAction action={modifierQuickAction.bind(null, g.id)} fields={{ modifierId: m.id, op: "archive" }} label={`${m.name}: arşivle`}>
                            <Archive aria-hidden="true" />
                          </QuickAction>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <div className="border-t border-border px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: "modifier", groupId: g.id, modifier: null })}>
                    <Plus aria-hidden="true" /> Seçenek ekle<span className="sr-only">: {g.name}</span>
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing?.kind === "group" ? (
        <GroupDialog key={editing.group?.id ?? "new"} group={editing.group} locales={locales} onClose={() => setEditing(null)} />
      ) : null}
      {editing?.kind === "modifier" ? (
        <ModifierDialog key={editing.modifier?.id ?? `new-${editing.groupId}`} groupId={editing.groupId} modifier={editing.modifier} locales={locales} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function useDialogSave(action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult | null>, onClose: () => void) {
  const toast = useToast();
  return useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) {
      toast(result.message ?? "Kaydedildi.", "success");
      onClose();
    }
    return result;
  }, null);
}

function GroupDialog({ group, locales, onClose }: { group: GroupView | null; locales: string[]; onClose: () => void }) {
  const { state, pending, onSubmit } = useDialogSave(saveModifierGroupAction.bind(null, group?.id ?? null), onClose);
  const err = (k: string) => fieldError(state, k);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={group ? `Grup: ${group.name}` : "Yeni ekstra grubu"}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormAlert state={state} />
        <Field id="mg-name" label="Grup adı" required error={err("name")}>
          <Input id="mg-name" name="name" maxLength={120} defaultValue={group?.name} placeholder="Pişirme Derecesi" aria-describedby={describedBy("mg-name", { error: err("name") })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="mg-min" label="En az seçim" error={err("minSelect")}>
            <Input id="mg-min" name="minSelect" type="number" min={0} max={50} defaultValue={group?.minSelect ?? 0} aria-describedby={describedBy("mg-min", { error: err("minSelect") })} />
          </Field>
          <Field id="mg-max" label="En fazla seçim" error={err("maxSelect")}>
            <Input id="mg-max" name="maxSelect" type="number" min={1} max={50} defaultValue={group?.maxSelect ?? 1} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox id="mg-required" name="required" label="Zorunlu" description="Müşteri en az bir seçim yapmalı (en az seçim ≥ 1)." defaultChecked={group?.required ?? false} />
          <Checkbox id="mg-active" name="active" label="Aktif" defaultChecked={group?.active ?? true} />
        </div>
        <TranslationFields idPrefix="mg-t" locales={locales} compact values={group?.translations ?? {}} errors={state && !state.ok ? state.fieldErrors : undefined} fields={[{ key: "name", label: "Grup adı" }]} />
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

function ModifierDialog({ groupId, modifier, locales, onClose }: { groupId: string; modifier: ModifierView | null; locales: string[]; onClose: () => void }) {
  const { state, pending, onSubmit } = useDialogSave(saveModifierAction.bind(null, groupId, modifier?.id ?? null), onClose);
  const err = (k: string) => fieldError(state, k);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={modifier ? `Seçenek: ${modifier.name}` : "Yeni seçenek"}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="mo-name" label="Ad" required error={err("name")}>
            <Input id="mo-name" name="name" maxLength={120} defaultValue={modifier?.name} placeholder="Cheddar" aria-describedby={describedBy("mo-name", { error: err("name") })} />
          </Field>
          <Field id="mo-price" label="Fiyat farkı" hint="0 veya pozitif, ör. 30,00" error={err("priceDelta")}>
            <Input id="mo-price" name="priceDelta" inputMode="decimal" defaultValue={modifier?.priceDelta ?? "0,00"} aria-describedby={describedBy("mo-price", { hint: true, error: err("priceDelta") })} />
          </Field>
        </div>
        <Checkbox id="mo-active" name="active" label="Aktif" defaultChecked={modifier?.active ?? true} />
        <TranslationFields idPrefix="mo-t" locales={locales} compact values={modifier?.translations ?? {}} errors={state && !state.ok ? state.fieldErrors : undefined} fields={[{ key: "name", label: "Ad" }]} />
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
