"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { CHANNEL_LABELS, SEGMENT_LABELS, type ChannelName, type SegmentName } from "@/lib/promotions/segments";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/promotions/template";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { describedBy, Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;
type Opt = { id: string; name: string };
const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export type CouponDefaults = {
  code: string;
  name: string;
  description: string;
  type: "FIXED_AMOUNT" | "PERCENTAGE" | "FREE_ITEM";
  value: string;
  percent: string;
  maxDiscount: string;
  minimumOrder: string;
  scope: "ALL" | "PRODUCTS" | "CATEGORIES";
  productIds: string[];
  categoryIds: string[];
  freeProductId: string;
  branchId: string;
  startDate: string;
  endDate: string;
  days: number[];
  startTime: string;
  endTime: string;
  usageLimit: string;
  perCustomerLimit: string;
  audience: "ANYONE" | "IDENTIFIED" | "LOYALTY_MEMBER" | "REPEAT_CUSTOMER";
  active: boolean;
};

function ValueFields({ type, d, err, products, label }: { type: CouponDefaults["type"]; d: Pick<CouponDefaults, "value" | "percent" | "maxDiscount" | "minimumOrder" | "freeProductId">; err: (k: string) => string | undefined; products: Opt[]; label: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {type === "FIXED_AMOUNT" ? (
        <Field id="pv-value" label={`${label} (₺)`} required error={err("value")} hint="Ör. 100 ya da 12,50">
          <Input id="pv-value" name="value" inputMode="decimal" defaultValue={d.value} aria-describedby={describedBy("pv-value", { hint: true, error: err("value") })} />
        </Field>
      ) : null}
      {type === "PERCENTAGE" ? (
        <>
          <Field id="pv-percent" label="Yüzde (%)" required error={err("percent")} hint="Ör. 10 ya da 12,5">
            <Input id="pv-percent" name="percent" inputMode="decimal" defaultValue={d.percent} aria-describedby={describedBy("pv-percent", { hint: true, error: err("percent") })} />
          </Field>
          <Field id="pv-max" label="En fazla indirim (₺)" error={err("maxDiscount")} hint="İsteğe bağlı tavan">
            <Input id="pv-max" name="maxDiscount" inputMode="decimal" defaultValue={d.maxDiscount} aria-describedby={describedBy("pv-max", { hint: true, error: err("maxDiscount") })} />
          </Field>
        </>
      ) : null}
      {type === "FREE_ITEM" ? (
        <Field id="pv-free" label="Ücretsiz ürün" required error={err("freeProductId")} hint="Ürün sepette olmalı; 1 adedi ücretsiz olur">
          <Select id="pv-free" name="freeProductId" defaultValue={d.freeProductId} aria-describedby={describedBy("pv-free", { hint: true, error: err("freeProductId") })}>
            <option value="">Seçin</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field id="pv-min" label="En az sepet (₺)" error={err("minimumOrder")} hint="İsteğe bağlı">
        <Input id="pv-min" name="minimumOrder" inputMode="decimal" defaultValue={d.minimumOrder} aria-describedby={describedBy("pv-min", { hint: true, error: err("minimumOrder") })} />
      </Field>
    </div>
  );
}

export function CouponForm({ action, defaults, products, categories, branches, mode }: { action: FormAction; defaults: CouponDefaults; products: Opt[]; categories: Opt[]; branches: Opt[]; mode: "create" | "edit" }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  const [type, setType] = useState(defaults.type);
  const [scope, setScope] = useState(defaults.scope);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6" data-testid="coupon-form">
      <FormAlert state={state && !state.ok ? state : null} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cp-code" label="Kod" required error={err("code")} hint="Büyük / küçük harf fark etmez. Harf, rakam, - ve _">
          <Input id="cp-code" name="code" defaultValue={defaults.code} maxLength={24} className="font-mono uppercase" autoComplete="off" aria-describedby={describedBy("cp-code", { hint: true, error: err("code") })} />
        </Field>
        <Field id="cp-name" label="Görünen ad" required error={err("name")} hint="Müşteri sepette bunu görür">
          <Input id="cp-name" name="name" defaultValue={defaults.name} maxLength={80} aria-describedby={describedBy("cp-name", { hint: true, error: err("name") })} />
        </Field>
      </div>
      <Field id="cp-type" label="Tür" required error={err("type")}>
        <Select id="cp-type" name="type" value={type} onChange={(e) => setType(e.target.value as CouponDefaults["type"])}>
          <option value="FIXED_AMOUNT">Sabit tutar indirim</option>
          <option value="PERCENTAGE">Yüzde indirim</option>
          <option value="FREE_ITEM">Ücretsiz ürün</option>
        </Select>
      </Field>
      <ValueFields type={type} d={defaults} err={err} products={products} label="İndirim tutarı" />
      {type !== "FREE_ITEM" ? (
        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium text-fg">Kapsam</legend>
          <Select id="cp-scope" name="scope" value={scope} onChange={(e) => setScope(e.target.value as CouponDefaults["scope"])} aria-label="Kapsam">
            <option value="ALL">Tüm sepet</option>
            <option value="PRODUCTS">Belirli ürünler</option>
            <option value="CATEGORIES">Belirli kategoriler</option>
          </Select>
          {scope !== "ALL" ? (
            <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {(scope === "PRODUCTS" ? products : categories).map((o) => (
                <label key={o.id} className="flex min-h-10 items-center gap-2 rounded px-2 text-sm hover:bg-surface">
                  <input type="checkbox" name={scope === "PRODUCTS" ? "productIds" : "categoryIds"} value={o.id} defaultChecked={(scope === "PRODUCTS" ? defaults.productIds : defaults.categoryIds).includes(o.id)} className="size-4" />
                  {o.name}
                </label>
              ))}
            </div>
          ) : null}
          {err("productIds") || err("categoryIds") ? <p className="text-[0.8125rem] text-danger">{err("productIds") ?? err("categoryIds")}</p> : null}
        </fieldset>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="cp-branch" label="Şube">
          <Select id="cp-branch" name="branchId" defaultValue={defaults.branchId}>
            <option value="">Tüm şubeler</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cp-audience" label="Kimler kullanabilir">
          <Select id="cp-audience" name="audience" defaultValue={defaults.audience}>
            <option value="ANYONE">Herkes (anonim dahil)</option>
            <option value="IDENTIFIED">Yalnızca kayıtlı müşteriler</option>
            <option value="LOYALTY_MEMBER">Sadakat üyeleri</option>
            <option value="REPEAT_CUSTOMER">Tekrar gelen müşteriler</option>
          </Select>
        </Field>
        <Field id="cp-usage" label="Toplam kullanım sınırı" error={err("usageLimit")} hint="Boş = sınırsız">
          <Input id="cp-usage" name="usageLimit" inputMode="numeric" defaultValue={defaults.usageLimit} aria-describedby={describedBy("cp-usage", { hint: true, error: err("usageLimit") })} />
        </Field>
        <Field id="cp-per" label="Kişi başı sınır" error={err("perCustomerLimit")} hint="Yalnızca kayıtlı müşteride uygulanır">
          <Input id="cp-per" name="perCustomerLimit" inputMode="numeric" defaultValue={defaults.perCustomerLimit} aria-describedby={describedBy("cp-per", { hint: true, error: err("perCustomerLimit") })} />
        </Field>
      </div>
      <fieldset className="grid gap-4">
        <legend className="text-sm font-medium text-fg">Geçerlilik (işletme saat dilimi)</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="cp-start" label="Başlangıç günü" error={err("startDate")}>
            <Input id="cp-start" name="startDate" type="date" defaultValue={defaults.startDate} />
          </Field>
          <Field id="cp-end" label="Bitiş günü (dahil)" error={err("endDate")}>
            <Input id="cp-end" name="endDate" type="date" defaultValue={defaults.endDate} />
          </Field>
          <Field id="cp-st" label="Saat başlangıç" hint="İsteğe bağlı">
            <Input id="cp-st" name="startTime" type="time" defaultValue={defaults.startTime} />
          </Field>
          <Field id="cp-et" label="Saat bitiş" error={err("endTime")}>
            <Input id="cp-et" name="endTime" type="time" defaultValue={defaults.endTime} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Geçerli günler (hiçbiri = her gün)">
          {WEEKDAYS.map((w, i) => (
            <label key={w} className="flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm">
              <input type="checkbox" name="days" value={i + 1} defaultChecked={defaults.days.includes(i + 1)} className="size-4" />
              {w}
            </label>
          ))}
        </div>
      </fieldset>
      <Field id="cp-desc" label="Açıklama / koşullar" hint="Müşteriye gösterilebilir kısa açıklama (≤ 300)">
        <Textarea id="cp-desc" name="description" rows={2} maxLength={300} defaultValue={defaults.description} aria-describedby="cp-desc-hint" />
      </Field>
      <Checkbox id="cp-active" name="active" label="Etkin" description="Etkin olmayan kupon müşteride “Kupon geçerli değil” görünür." defaultChecked={defaults.active} />
      <div>
        <Button type="submit" loading={pending} data-testid="coupon-submit">
          {mode === "create" ? "Kuponu oluştur" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}

export type RewardDefaults = { name: string; description: string; pointsCost: string; type: CouponDefaults["type"]; value: string; percent: string; maxDiscount: string; minimumOrder: string; freeProductId: string; startDate: string; endDate: string; active: boolean };

export function RewardForm({ action, defaults, products, mode }: { action: FormAction; defaults: RewardDefaults; products: Opt[]; mode: "create" | "edit" }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  const [type, setType] = useState(defaults.type);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6" data-testid="reward-form">
      <FormAlert state={state && !state.ok ? state : null} />
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field id="rw-name" label="Ödül adı" required error={err("name")}>
          <Input id="rw-name" name="name" defaultValue={defaults.name} maxLength={80} aria-describedby={describedBy("rw-name", { error: err("name") })} />
        </Field>
        <Field id="rw-cost" label="Puan bedeli" required error={err("pointsCost")}>
          <Input id="rw-cost" name="pointsCost" inputMode="numeric" defaultValue={defaults.pointsCost} aria-describedby={describedBy("rw-cost", { error: err("pointsCost") })} />
        </Field>
      </div>
      <Field id="rw-type" label="Ödül türü" required>
        <Select id="rw-type" name="type" value={type} onChange={(e) => setType(e.target.value as RewardDefaults["type"])}>
          <option value="FIXED_AMOUNT">Sabit tutar indirim</option>
          <option value="PERCENTAGE">Yüzde indirim</option>
          <option value="FREE_ITEM">Ücretsiz ürün</option>
        </Select>
      </Field>
      <ValueFields type={type} d={defaults} err={err} products={products} label="İndirim tutarı" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rw-start" label="Başlangıç günü" error={err("startDate")}>
          <Input id="rw-start" name="startDate" type="date" defaultValue={defaults.startDate} />
        </Field>
        <Field id="rw-end" label="Bitiş günü (dahil)" error={err("endDate")}>
          <Input id="rw-end" name="endDate" type="date" defaultValue={defaults.endDate} />
        </Field>
      </div>
      <Field id="rw-desc" label="Açıklama" hint="Müşteri sepette görür (≤ 300)">
        <Textarea id="rw-desc" name="description" rows={2} maxLength={300} defaultValue={defaults.description} aria-describedby="rw-desc-hint" />
      </Field>
      <Checkbox id="rw-active" name="active" label="Etkin" description="Etkin ödüller sadakat üyesine sepette gösterilir." defaultChecked={defaults.active} />
      <div>
        <Button type="submit" loading={pending} data-testid="reward-submit">
          {mode === "create" ? "Ödülü oluştur" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}

export type CampaignDefaults = { name: string; channel: ChannelName; segment: SegmentName; couponId: string; messageTemplate: string };

export function CampaignForm({ action, defaults, coupons, mode }: { action: FormAction; defaults: CampaignDefaults; coupons: { id: string; code: string }[]; mode: "create" | "edit" }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" data-testid="campaign-form">
      <FormAlert state={state && !state.ok ? state : null} />
      <Field id="cm-name" label="Kampanya adı" required error={err("name")}>
        <Input id="cm-name" name="name" defaultValue={defaults.name} maxLength={80} aria-describedby={describedBy("cm-name", { error: err("name") })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="cm-channel" label="Kanal" required error={err("channel")} hint="Kitle bu kanalın izniyle süzülür">
          <Select id="cm-channel" name="channel" defaultValue={defaults.channel} aria-describedby="cm-channel-hint">
            {(Object.keys(CHANNEL_LABELS) as ChannelName[]).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cm-segment" label="Segment" required error={err("segment")}>
          <Select id="cm-segment" name="segment" defaultValue={defaults.segment}>
            {(Object.keys(SEGMENT_LABELS) as SegmentName[]).map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cm-coupon" label="Kupon (isteğe bağlı)">
          <Select id="cm-coupon" name="couponId" defaultValue={defaults.couponId}>
            <option value="">Yok</option>
            {coupons.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="cm-template" label="Mesaj taslağı (düz metin)" error={err("messageTemplate")} hint={`Kullanılabilir alanlar: ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}`}>
        <Textarea id="cm-template" name="messageTemplate" rows={4} maxLength={1000} defaultValue={defaults.messageTemplate} aria-describedby={describedBy("cm-template", { hint: true, error: err("messageTemplate") })} />
      </Field>
      <div>
        <Button type="submit" loading={pending} data-testid="campaign-submit">
          {mode === "create" ? "Taslağı oluştur" : "Taslağı kaydet"}
        </Button>
      </div>
    </form>
  );
}

export function StateButton({ action, label, variant = "secondary", confirmText, testId }: { action: () => Promise<ActionResult>; label: string; variant?: ButtonVariant; confirmText?: string; testId?: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant={variant}
      loading={pending}
      data-testid={testId}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        start(async () => {
          const r = await action();
          toast(r.ok ? (r.message ?? "Güncellendi.") : r.error, r.ok ? "success" : "error");
          if (r.ok) router.refresh();
        });
      }}
    >
      {label}
    </Button>
  );
}
