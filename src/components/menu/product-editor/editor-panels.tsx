"use client";

import { ArrowDown, ArrowUp, Archive, ImageOff, Link2Off, Pencil, Plus, Star } from "lucide-react";
import Image from "next/image";
import { MAX_PRODUCT_IMAGES } from "@/lib/media/limits";
import { ImageUploader } from "@/components/media/image-uploader";
import Link from "next/link";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { QuickAction } from "@/components/menu/quick-action";
import { TranslationFields, type TranslationValues } from "@/components/menu/translation-fields";
import { Badge } from "@/components/ui/badge";
import { useFormAction } from "@/components/ui/use-form-action";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/** Dialog içindeki formlar: başarıda toast + kapanış. */
function useDialogAction(action: FormAction, onSuccess: () => void) {
  const toast = useToast();
  return useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) {
      toast(result.message ?? "Kaydedildi.", "success");
      onSuccess();
    }
    return result;
  }, null);
}

// ─── Varyantlar ─────────────────────────────────────────────────────────────

export type VariantView = {
  id: string;
  name: string;
  sku: string;
  price: string;
  priceLabel: string;
  active: boolean;
  isDefault: boolean;
  translations: TranslationValues;
};

export function VariantsPanel({
  variants,
  readOnly,
  locales,
  saveAction,
  quickAction,
}: {
  variants: VariantView[];
  readOnly: boolean;
  locales: string[];
  /** Ürün kimliği sunucuda bağlanmış eylem; varyant kimliği burada bağlanır (null → yeni varyant). */
  saveAction: (variantId: string | null, state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;
  quickAction: FormAction;
}) {
  const [editing, setEditing] = useState<VariantView | "new" | null>(null);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">Ör. Tek / Çift, Küçük / Orta / Büyük. Fiyatı boş bırakılan varyant taban fiyatı kullanır. Tam olarak bir varyant varsayılandır.</p>
        {!readOnly ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" /> Varyant ekle
          </Button>
        ) : null}
      </div>
      {variants.length === 0 ? (
        <EmptyState title="Varyant yok" description="Ürün tek seçenekle satılıyor; taban fiyat kullanılır." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {variants.map((v, i) => (
            <li key={v.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{v.name}</span>
                <span className="tabular-nums text-fg-muted">{v.priceLabel}</span>
                {v.isDefault ? <Badge tone="accent">Varsayılan</Badge> : null}
                {!v.active ? <Badge>Pasif</Badge> : null}
              </div>
              {!readOnly ? (
                <div className="flex flex-wrap items-center gap-0.5">
                  <QuickAction action={quickAction} fields={{ variantId: v.id, op: "up" }} label={`${v.name}: yukarı`} disabled={i === 0}>
                    <ArrowUp aria-hidden="true" />
                  </QuickAction>
                  <QuickAction action={quickAction} fields={{ variantId: v.id, op: "down" }} label={`${v.name}: aşağı`} disabled={i === variants.length - 1}>
                    <ArrowDown aria-hidden="true" />
                  </QuickAction>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(v)}>
                    <Pencil aria-hidden="true" /> Düzenle<span className="sr-only">: {v.name}</span>
                  </Button>
                  <ConfirmDialog
                    action={quickAction}
                    hidden={{ variantId: v.id, op: "archive" }}
                    triggerLabel={
                      <>
                        <Archive aria-hidden="true" /> Arşivle
                      </>
                    }
                    triggerVariant="ghost"
                    title={`${v.name} arşivlensin mi?`}
                    description="Varyant menüden kalkar; kayıt korunur (gelecekteki sipariş geçmişi için). Varsayılan varyantsa sıradaki varsayılan olur."
                    confirmLabel="Arşivle"
                    destructive
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <VariantDialog
          key={editing === "new" ? "new" : editing.id}
          variant={editing === "new" ? null : editing}
          locales={locales}
          action={saveAction.bind(null, editing === "new" ? null : editing.id)}
          onClose={() => setEditing(null)}
          firstVariant={variants.length === 0}
        />
      ) : null}
    </div>
  );
}

function VariantDialog({
  variant,
  locales,
  action,
  onClose,
  firstVariant,
}: {
  variant: VariantView | null;
  locales: string[];
  action: FormAction;
  onClose: () => void;
  firstVariant: boolean;
}) {
  const { state, pending, onSubmit } = useDialogAction(action, onClose);
  const err = (k: string) => fieldError(state, k);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={variant ? `Varyant: ${variant.name}` : "Yeni varyant"}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="v-name" label="Ad" required error={err("name")}>
            <Input id="v-name" name="name" maxLength={60} defaultValue={variant?.name} placeholder="Büyük" aria-describedby={describedBy("v-name", { error: err("name") })} />
          </Field>
          <Field id="v-price" label="Fiyat" hint="Boş → taban fiyat" error={err("price")}>
            <Input id="v-price" name="price" inputMode="decimal" defaultValue={variant?.price} placeholder="0,00" aria-describedby={describedBy("v-price", { hint: true, error: err("price") })} />
          </Field>
          <Field id="v-sku" label="SKU" error={err("sku")}>
            <Input id="v-sku" name="sku" maxLength={64} defaultValue={variant?.sku} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox id="v-active" name="active" label="Aktif" defaultChecked={variant?.active ?? true} />
          <Checkbox id="v-default" name="isDefault" label="Varsayılan varyant" defaultChecked={variant?.isDefault ?? firstVariant} />
        </div>
        <TranslationFields idPrefix="v-t" locales={locales} compact values={variant?.translations ?? {}} errors={state && !state.ok ? state.fieldErrors : undefined} fields={[{ key: "name", label: "Ad", maxLength: 60 }]} />
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

// ─── Ekstra grupları ────────────────────────────────────────────────────────

export type AttachedGroupView = { id: string; name: string; rule: string; modifierCount: number; active: boolean };

export function ModifiersPanel({
  attached,
  available,
  readOnly,
  action,
}: {
  attached: AttachedGroupView[];
  available: { id: string; name: string }[];
  readOnly: boolean;
  action: FormAction;
}) {
  const toast = useToast();
  const { state, pending, onSubmit: onAttach } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok && result.message) toast(result.message, "success");
    return result;
  }, null);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-fg-muted">
        Ekstra grupları (ör. “Pişirme Derecesi”, “Ekstra Malzemeler”) birden çok üründe kullanılabilir. Grupları ve ekstraları{" "}
        <Link href="/panel/menu/ekstralar" className="font-medium text-fg underline underline-offset-4">
          Ekstralar
        </Link>{" "}
        sayfasından yönetin.
      </p>
      {attached.length === 0 ? (
        <EmptyState title="Bağlı ekstra grubu yok" />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {attached.map((g, i) => (
            <li key={g.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  {!g.active ? <Badge>Pasif</Badge> : null}
                </div>
                <div className="text-xs text-fg-subtle">
                  {g.rule} · {g.modifierCount} seçenek
                </div>
              </div>
              {!readOnly ? (
                <div className="flex items-center gap-0.5">
                  <QuickAction action={action} fields={{ groupId: g.id, op: "up" }} label={`${g.name}: yukarı`} disabled={i === 0}>
                    <ArrowUp aria-hidden="true" />
                  </QuickAction>
                  <QuickAction action={action} fields={{ groupId: g.id, op: "down" }} label={`${g.name}: aşağı`} disabled={i === attached.length - 1}>
                    <ArrowDown aria-hidden="true" />
                  </QuickAction>
                  <QuickAction action={action} fields={{ groupId: g.id, op: "detach" }} label={`${g.name}: üründen ayır`}>
                    <Link2Off aria-hidden="true" /> <span className="text-xs">Ayır</span>
                  </QuickAction>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!readOnly ? (
        available.length > 0 ? (
          <form onSubmit={onAttach} className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-3 sm:flex-row sm:items-end">
            <input type="hidden" name="op" value="attach" />
            <Field id="attach-group" label="Ekstra grubu bağla" className="flex-1">
              <Select id="attach-group" name="groupId" defaultValue="">
                <option value="" disabled>
                  Grup seçin…
                </option>
                {available.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" loading={pending}>
              Bağla
            </Button>
            {state && !state.ok ? (
              <p role="alert" className="text-sm text-danger">
                {state.error}
              </p>
            ) : null}
          </form>
        ) : (
          <Link href="/panel/menu/ekstralar" className={buttonVariants({ variant: "secondary", size: "sm", className: "justify-self-start" })}>
            <Plus aria-hidden="true" /> Ekstra grubu oluştur
          </Link>
        )
      ) : null}
    </div>
  );
}

// ─── Görseller ──────────────────────────────────────────────────────────────

export type ImageView = { id: string; url: string | null; altText: string; isPrimary: boolean; managed: boolean };

export function ImagesPanel({ productId, images, readOnly, action }: { productId: string; images: ImageView[]; readOnly: boolean; action: FormAction }) {
  const toast = useToast();
  const { state, pending, onSubmit: onAdd, formRef: addRef } = useFormAction(
    async (prev: ActionResult | null, fd: FormData) => {
      const result = await action(prev, fd);
      if (result?.ok && result.message) toast(result.message, "success");
      return result;
    },
    null,
    { resetOnSuccess: (s) => !!s?.ok },
  );
  const err = (k: string) => fieldError(state, k);
  return (
    <div className="grid gap-4">
      {!readOnly && images.length < MAX_PRODUCT_IMAGES ? (
        <ImageUploader kind="PRODUCT" label="Bilgisayardan görsel ekle" testId="product-uploader" currentUrl={null} fields={{ productId }} className="max-w-md" />
      ) : null}
      {images.length === 0 ? (
        <EmptyState icon={ImageOff} title="Görsel yok" description="Görselli ürünler menüde daha çok ilgi görür." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((img, i) => (
            <li key={img.id} className="overflow-hidden rounded-lg border border-border bg-bg" data-testid="product-image" data-managed={img.managed ? "1" : "0"}>
              <div className="relative aspect-[4/3] bg-surface">
                {img.url ? <Image src={img.url} alt={img.altText} fill sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" unoptimized className="object-cover" /> : null}
                {img.isPrimary ? (
                  <span className="absolute left-2 top-2">
                    <Badge tone="accent">Ana görsel</Badge>
                  </span>
                ) : null}
              </div>
              <div className="grid gap-2 p-3">
                <ImageAltForm image={img} readOnly={readOnly} action={action} />
                {!readOnly ? (
                  <div className="flex flex-wrap items-center gap-0.5">
                    {!img.isPrimary ? (
                      <QuickAction action={action} fields={{ op: "primary", imageId: img.id }} label="Ana görsel yap">
                        <Star aria-hidden="true" /> <span className="text-xs">Ana yap</span>
                      </QuickAction>
                    ) : null}
                    <QuickAction action={action} fields={{ op: "up", imageId: img.id }} label="Görseli öne al" disabled={i === 0}>
                      <ArrowUp aria-hidden="true" />
                    </QuickAction>
                    <QuickAction action={action} fields={{ op: "down", imageId: img.id }} label="Görseli geriye al" disabled={i === images.length - 1}>
                      <ArrowDown aria-hidden="true" />
                    </QuickAction>
                    <ImageUploader kind="PRODUCT" compact compactLabel="Değiştir" label="Görseli değiştir" testId="product-replace" currentUrl={img.url} fields={{ productId, replaceImageId: img.id }} />
                    <ConfirmDialog
                      action={action}
                      hidden={{ op: "remove", imageId: img.id }}
                      triggerLabel="Kaldır"
                      triggerVariant="ghost"
                      title="Görsel kaldırılsın mı?"
                      description={img.managed ? "Görsel üründen kaldırılır ve yüklenen dosya silinir." : "Görsel bağlantısı üründen kaldırılır (harici dosyanın kendisi silinmez)."}
                      confirmLabel="Kaldır"
                      destructive
                    />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!readOnly ? (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg-muted">Harici adresle ekle (https)</summary>
          <form ref={addRef} onSubmit={onAdd} noValidate className="grid gap-3 border-t border-border p-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <input type="hidden" name="op" value="add" />
            <Field id="img-url" label="Görsel adresi (https)" error={err("url")}>
              <Input id="img-url" name="url" type="url" placeholder="https://…/urun.webp" aria-describedby={describedBy("img-url", { error: err("url") })} />
            </Field>
            <Field id="img-alt" label="Alternatif metin" error={err("altText")}>
              <Input id="img-alt" name="altText" maxLength={160} placeholder="Ör. Izgara köfte tabağı" />
            </Field>
            <Button type="submit" loading={pending}>
              Ekle
            </Button>
            {state && !state.ok && !err("url") ? (
              <p role="alert" className="text-sm text-danger sm:col-span-3">
                {state.error}
              </p>
            ) : null}
          </form>
        </details>
      ) : null}
    </div>
  );
}

function ImageAltForm({ image, readOnly, action }: { image: ImageView; readOnly: boolean; action: FormAction }) {
  const toast = useToast();
  const { pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result) toast(result.ok ? (result.message ?? "Kaydedildi.") : result.error, result.ok ? "success" : "error");
    return result;
  }, null);
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <input type="hidden" name="op" value="alt" />
      <input type="hidden" name="imageId" value={image.id} />
      <div className="grid flex-1 gap-1">
        <label htmlFor={`alt-${image.id}`} className="text-xs text-fg-subtle">
          Alternatif metin
        </label>
        <input
          id={`alt-${image.id}`}
          name="altText"
          defaultValue={image.altText}
          maxLength={160}
          disabled={readOnly}
          className="h-9 rounded-md border border-border-strong bg-bg px-2.5 text-sm"
        />
      </div>
      {!readOnly ? (
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Kaydet
        </Button>
      ) : null}
    </form>
  );
}

// ─── Şubeler ────────────────────────────────────────────────────────────────

export type BranchOverrideView = {
  branchId: string;
  branchName: string;
  branchActive: boolean;
  available: "inherit" | "yes" | "no";
  soldOut: "inherit" | "yes" | "no";
  price: string;
  resolvedLabel: string;
  availabilityLabel: string;
  variants: { id: string; name: string; price: string; resolvedLabel: string }[];
};

export function BranchesPanel({ branches, readOnly, action, basePriceLabel }: { branches: BranchOverrideView[]; readOnly: boolean; action: FormAction; basePriceLabel: string }) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-fg-muted">
        Ürün işletme kataloğundadır; şubeler yalnızca farkları geçersiz kılar. Boş/“Ürün varsayılanı” bırakılan alanlar ürün ayarını kullanır (taban fiyat: {basePriceLabel}).
      </p>
      {branches.length === 0 ? <EmptyState title="Şube yok" /> : null}
      {branches.map((b) => (
        <BranchOverrideForm key={b.branchId} branch={b} readOnly={readOnly} action={action} />
      ))}
    </div>
  );
}

function BranchOverrideForm({ branch, readOnly, action }: { branch: BranchOverrideView; readOnly: boolean; action: FormAction }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok && result.message) toast(result.message, "success");
    return result;
  }, null);
  const err = (k: string) => fieldError(state, k);
  const id = (k: string) => `bo-${branch.branchId}-${k}`;
  const triOptions = (yes: string, no: string) => (
    <>
      <option value="inherit">Ürün varsayılanı</option>
      <option value="yes">{yes}</option>
      <option value="no">{no}</option>
    </>
  );
  return (
    <form onSubmit={onSubmit} noValidate className="rounded-lg border border-border bg-bg">
      <input type="hidden" name="branchId" value={branch.branchId} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{branch.branchName}</h3>
          {!branch.branchActive ? <Badge>Şube pasif</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-subtle">Bu şubede:</span>
          <span className="font-medium tabular-nums">{branch.resolvedLabel}</span>
          <Badge tone={branch.availabilityLabel === "Satışta" ? "success" : branch.availabilityLabel === "Tükendi" ? "warning" : "neutral"} dot>
            {branch.availabilityLabel}
          </Badge>
        </div>
      </div>
      <fieldset disabled={readOnly} className="grid gap-4 p-4">
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id={id("available")} label="Satış">
            <Select id={id("available")} name="available" defaultValue={branch.available}>
              {triOptions("Satılıyor", "Bu şubede satılmıyor")}
            </Select>
          </Field>
          <Field id={id("soldOut")} label="Tükendi">
            <Select id={id("soldOut")} name="soldOut" defaultValue={branch.soldOut}>
              {triOptions("Tükendi", "Stokta")}
            </Select>
          </Field>
          <Field id={id("price")} label="Şube fiyatı" hint="Boş → taban fiyat" error={err("price")}>
            <Input id={id("price")} name="price" inputMode="decimal" defaultValue={branch.price} placeholder="—" aria-describedby={describedBy(id("price"), { hint: true, error: err("price") })} />
          </Field>
        </div>
        {branch.variants.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Varyant fiyatları (bu şube)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {branch.variants.map((v) => (
                <Field key={v.id} id={id(`v-${v.id}`)} label={`${v.name} · şu an ${v.resolvedLabel}`} error={err(`variantPrices.${v.id}`)}>
                  <Input id={id(`v-${v.id}`)} name={`variantPrice.${v.id}`} inputMode="decimal" defaultValue={v.price} placeholder="—" />
                </Field>
              ))}
            </div>
          </div>
        ) : null}
        {!readOnly ? (
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={pending}>
              {branch.branchName} için kaydet
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
