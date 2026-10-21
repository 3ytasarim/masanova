"use client";

import { ArrowDown, ArrowUp, CornerDownRight, Eye, EyeOff, FolderPlus, Pencil, Plus, Star, StarOff } from "lucide-react";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { categoryQuickAction, saveCategoryAction } from "@/server/actions/menu.actions";
import { NameSlugFields } from "@/components/menu/name-slug-fields";
import { QuickAction } from "@/components/menu/quick-action";
import { TranslationFields, type TranslationValues } from "@/components/menu/translation-fields";
import { Badge } from "@/components/ui/badge";
import { useFormAction } from "@/components/ui/use-form-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { ImageUploader } from "@/components/media/image-uploader";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

export type CategoryView = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  /** Harici (https) adres — yalnızca yüklenmiş banner yoksa kullanılır. */
  imageUrl: string | null;
  /** Gösterilen görsel (yüklenen banner ya da harici adres). */
  imageDisplayUrl: string | null;
  imageManaged: boolean;
  active: boolean;
  featured: boolean;
  productCount: number;
  translations: TranslationValues;
  missingTranslations: string[];
};

type Editing = { mode: "create"; parentId: string | null } | { mode: "edit"; category: CategoryView } | null;

export function CategoryManager({
  categories,
  translatableLocales,
  canManage,
  openCreate,
}: {
  categories: CategoryView[];
  translatableLocales: string[];
  canManage: boolean;
  openCreate: boolean;
}) {
  const [editing, setEditing] = useState<Editing>(openCreate && canManage ? { mode: "create", parentId: null } : null);
  const roots = categories.filter((c) => c.parentId === null);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-subtle">En fazla bir seviye alt kategori. Sıralama menüde aynen kullanılır.</p>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing({ mode: "create", parentId: null })}>
            <Plus aria-hidden="true" /> Yeni Kategori
          </Button>
        ) : null}
      </div>

      {roots.length === 0 ? (
        <EmptyState icon={FolderPlus} title="Henüz kategori yok" description="Ör. Çorbalar, Ana Yemekler, İçecekler." />
      ) : (
        <ol className="grid gap-3" aria-label="Kategoriler">
          {roots.map((root, i) => (
            <li key={root.id} className="overflow-hidden rounded-lg border border-border bg-bg">
              <CategoryRow
                category={root}
                isFirst={i === 0}
                isLast={i === roots.length - 1}
                canManage={canManage}
                onEdit={() => setEditing({ mode: "edit", category: root })}
                onAddChild={() => setEditing({ mode: "create", parentId: root.id })}
              />
              {childrenOf(root.id).length > 0 ? (
                <ol className="border-t border-border bg-surface" aria-label={`${root.name} alt kategorileri`}>
                  {childrenOf(root.id).map((child, j, list) => (
                    <li key={child.id} className="border-b border-border last:border-b-0">
                      <CategoryRow
                        category={child}
                        nested
                        isFirst={j === 0}
                        isLast={j === list.length - 1}
                        canManage={canManage}
                        onEdit={() => setEditing({ mode: "edit", category: child })}
                      />
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {editing ? (
        <CategoryDialog
          key={editing.mode === "edit" ? editing.category.id : `new-${editing.parentId ?? "root"}`}
          // Görsel yükleme sayfayı yeniler (router.refresh): açık pencere güncel kategori verisini kullansın.
          editing={editing.mode === "edit" ? { mode: "edit", category: categories.find((c) => c.id === editing.category.id) ?? editing.category } : editing}
          roots={roots}
          hasChildren={editing.mode === "edit" && childrenOf(editing.category.id).length > 0}
          translatableLocales={translatableLocales}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function CategoryRow({
  category,
  nested,
  isFirst,
  isLast,
  canManage,
  onEdit,
  onAddChild,
}: {
  category: CategoryView;
  nested?: boolean;
  isFirst: boolean;
  isLast: boolean;
  canManage: boolean;
  onEdit: () => void;
  onAddChild?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        {nested ? <CornerDownRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" /> : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{category.name}</span>
            {!category.active ? <Badge>Pasif</Badge> : null}
            {category.featured ? <Badge tone="accent">Öne çıkan</Badge> : null}
            {category.missingTranslations.length > 0 ? <Badge tone="warning">Çeviri eksik: {category.missingTranslations.join(", ").toUpperCase()}</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-fg-subtle">
            <span className="font-mono">{category.slug}</span> · {category.productCount} ürün
          </div>
        </div>
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-0.5">
          <QuickAction action={categoryQuickAction} fields={{ id: category.id, op: "up" }} label={`${category.name}: yukarı taşı`} disabled={isFirst}>
            <ArrowUp aria-hidden="true" />
          </QuickAction>
          <QuickAction action={categoryQuickAction} fields={{ id: category.id, op: "down" }} label={`${category.name}: aşağı taşı`} disabled={isLast}>
            <ArrowDown aria-hidden="true" />
          </QuickAction>
          <QuickAction
            action={categoryQuickAction}
            fields={{ id: category.id, op: "active", value: String(!category.active) }}
            label={category.active ? `${category.name}: pasifleştir` : `${category.name}: aktifleştir`}
          >
            {category.active ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
          </QuickAction>
          <QuickAction
            action={categoryQuickAction}
            fields={{ id: category.id, op: "featured", value: String(!category.featured) }}
            label={category.featured ? `${category.name}: öne çıkarmayı kaldır` : `${category.name}: öne çıkar`}
          >
            {category.featured ? <Star aria-hidden="true" className="fill-current text-accent-strong" /> : <StarOff aria-hidden="true" />}
          </QuickAction>
          {onAddChild ? (
            <Button variant="ghost" size="sm" onClick={onAddChild}>
              <Plus aria-hidden="true" /> Alt kategori
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil aria-hidden="true" /> Düzenle<span className="sr-only">: {category.name}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CategoryDialog({
  editing,
  roots,
  hasChildren,
  translatableLocales,
  onClose,
}: {
  editing: NonNullable<Editing>;
  roots: CategoryView[];
  hasChildren: boolean;
  translatableLocales: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const category = editing.mode === "edit" ? editing.category : null;
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await saveCategoryAction(category?.id ?? null, prev, fd);
    if (result?.ok) {
      toast(result.message ?? "Kaydedildi.", "success");
      onClose();
    }
    return result;
  }, null);
  const err = (k: string) => fieldError(state, k);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const parentOptions = roots.filter((r) => r.id !== category?.id);
  const defaultParent = category ? (category.parentId ?? "") : editing.mode === "create" ? (editing.parentId ?? "") : "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={category ? `Kategori: ${category.name}` : "Yeni kategori"} className="max-h-[90dvh]">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NameSlugFields idPrefix="cat" defaultName={category?.name} defaultSlug={category?.slug} errors={{ name: err("name"), slug: err("slug") }} />
        </div>
        <Field id="cat-parent" label="Üst kategori" error={err("parentId")} hint={hasChildren ? "Alt kategorileri olduğu için bu kategori ana kategori kalmalı." : "Boş bırakılırsa ana kategori olur."}>
          <Select id="cat-parent" name="parentId" defaultValue={defaultParent} disabled={hasChildren} aria-describedby={describedBy("cat-parent", { hint: true, error: err("parentId") })}>
            <option value="">— Ana kategori —</option>
            {parentOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cat-description" label="Açıklama" error={err("description")}>
          <Textarea id="cat-description" name="description" rows={2} maxLength={500} defaultValue={category?.description ?? ""} />
        </Field>
        {category ? (
          <ImageUploader
            kind="CATEGORY"
            label="Kategori banner'ı"
            testId="category-uploader"
            currentUrl={category.imageManaged ? category.imageDisplayUrl : null}
            fields={{ categoryId: category.id }}
            removeBody={category.imageManaged ? { categoryId: category.id } : undefined}
          />
        ) : (
          <p className="text-sm text-fg-subtle">Banner görseli, kategori oluşturulduktan sonra bilgisayardan yüklenebilir.</p>
        )}
        {category?.imageManaged ? null : (
          <Field id="cat-image" label="veya görsel adresi (https)" error={err("imageUrl")} hint="İsteğe bağlı; yüklenen banner varsa kullanılmaz.">
            <Input id="cat-image" name="imageUrl" type="url" defaultValue={category?.imageUrl ?? ""} aria-describedby={describedBy("cat-image", { hint: true, error: err("imageUrl") })} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox id="cat-active" name="active" label="Aktif" description="Pasif kategori ve ürünleri menüde görünmez." defaultChecked={category?.active ?? true} />
          <Checkbox id="cat-featured" name="featured" label="Öne çıkan" defaultChecked={category?.featured ?? false} />
        </div>
        <TranslationFields
          idPrefix="cat-t"
          locales={translatableLocales}
          compact
          errors={errors}
          values={category?.translations ?? {}}
          fields={[
            { key: "name", label: "Ad", maxLength: 120 },
            { key: "description", label: "Açıklama", multiline: true, maxLength: 500 },
          ]}
        />
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" loading={pending}>
            {category ? "Kaydet" : "Kategoriyi oluştur"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
