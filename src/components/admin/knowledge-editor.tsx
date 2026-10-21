"use client";

import Link from "next/link";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { KnowledgeTestResult } from "@/server/actions/knowledge.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/components/ui/use-form-action";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

const PLACEHOLDER = `Örnek:

Diyabet (şeker hastalığı)
Diyabetli misafire yalnızca salata önerme; doyurucu, dengeli bir öğün kur. Izgara et, tavuk ya da balık uygundur.
Beyaz pilav ve patates yerine bulgur ya da salata konmasını mutfağa not olarak öner.
Bira arpa maltından yapılır, kan şekerini yükseltir; önerme. Tatlı ve şekerli içecek önerme.
Bir öğünde 500–600 kaloriyi aşmamak önerilir.

Kilo vermek isteyenler
Öğün başına 450–550 kalori yeterlidir. Kızartma yerine ızgara, sos ayrı.`;

export function KnowledgeForm({ action, defaults, cancelHref, mode }: { action: FormAction; defaults: { title: string; content: string; active: boolean; sortOrder: number }; cancelHref: string; mode: "create" | "edit" }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  const err = (k: string) => fieldError(state, k);
  const [length, setLength] = useState(defaults.content.length);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" data-testid="knowledge-form">
      <FormAlert state={state} />
      <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
        <Field id="kn-title" label="Başlık" required error={err("title")} hint="Garson bu başlıkları konu dizini olarak görür (ör. Diyabet ve beslenme, Kalori rehberi).">
          <Input id="kn-title" name="title" defaultValue={defaults.title} maxLength={120} aria-invalid={err("title") ? true : undefined} aria-describedby={describedBy("kn-title", { hint: true, error: err("title") })} />
        </Field>
        <Field id="kn-order" label="Sıra" error={err("sortOrder")}>
          <Input id="kn-order" name="sortOrder" type="number" min={0} max={10000} defaultValue={defaults.sortOrder} />
        </Field>
      </div>
      <Field
        id="kn-content"
        label="Eğitim metni"
        required
        error={err("content")}
        hint={`${length.toLocaleString("tr-TR")} / 30.000 karakter · Konuları boş satırla ayırın; garson soruya en uygun bölümleri okur. Kalori bilgisi menüde girilmiş ürünlerle hesaplanır.`}
      >
        <Textarea
          id="kn-content"
          name="content"
          rows={22}
          defaultValue={defaults.content}
          placeholder={PLACEHOLDER}
          maxLength={30000}
          onChange={(e) => setLength(e.target.value.length)}
          className="font-mono text-[0.875rem]"
          aria-invalid={err("content") ? true : undefined}
          aria-describedby={describedBy("kn-content", { hint: true, error: err("content") })}
        />
      </Field>
      <div className="max-w-md rounded-lg border border-border p-4">
        <Switch id="kn-active" name="active" label="Etkin" description="Etkin metinler tüm işletmelerin sesli garsonuna hemen (yeni konuşmalarda) uygulanır." defaultChecked={defaults.active} />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Link href={cancelHref} className={buttonVariants({ variant: "secondary" })}>
          Vazgeç
        </Link>
        <Button type="submit" loading={pending}>
          {mode === "create" ? "Metni ekle" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}

type TestAction = (state: KnowledgeTestResult, formData: FormData) => Promise<KnowledgeTestResult>;

export function KnowledgeTester({ action, tenants }: { action: TestAction; tenants: { id: string; name: string }[] }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  const plain = state as unknown as ActionResult | null;
  const r = state?.ok ? state.data : null;
  const kcal = (c: number | null) => (c === null ? "kalori girilmemiş" : `${c} kcal`);
  return (
    <div className="grid gap-5">
      <form onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="knowledge-tester">
        <FormAlert state={plain} />
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <Field id="kt-tenant" label="İşletme (menü)">
            <Select id="kt-tenant" name="tenantId" defaultValue={tenants[0]?.id}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="kt-sentence" label="Müşteri ne diyor?" error={fieldError(plain, "sentence")}>
            <Input id="kt-sentence" name="sentence" placeholder="Ben şeker hastasıyım, 600 kaloriyi geçmeyen ne önerirsiniz?" maxLength={300} />
          </Field>
          <Button type="submit" loading={pending}>
            Dene
          </Button>
        </div>
      </form>

      {r ? (
        <div className="grid gap-4 rounded-xl border border-border bg-surface p-4 text-sm" data-testid="knowledge-test-result" aria-live="polite">
          <p className="text-fg-muted">
            <span className="font-medium text-fg">{r.tenantName}</span> · Algılanan durum: <span className="font-medium text-fg">{r.guidance.conditionLabel ?? "—"}</span> · Menüde kalorisi girilmiş ürün: {r.guidance.productsWithCalories}
          </p>
          <div>
            <p className="mb-1.5 font-semibold text-fg">Garsonun okuyacağı eğitim bölümleri</p>
            {r.guidance.knowledge.length === 0 ? (
              <p className="text-fg-subtle">Bu cümleyle eşleşen eğitim metni bölümü yok.</p>
            ) : (
              <ul className="grid gap-2">
                {r.guidance.knowledge.map((s, i) => (
                  <li key={i} className="whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-[0.8125rem] leading-relaxed">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-subtle">{s.document}</span>
                    {s.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1.5 font-semibold text-success">Önerilebilir</p>
              <ul className="grid gap-1">
                {r.guidance.good.map((i) => (
                  <li key={i.key}>
                    <span className="font-medium text-fg">{i.name}</span> <span className="text-fg-subtle">· {i.priceLabel} · {kcal(i.calories)}</span>
                  </li>
                ))}
                {r.guidance.good.length === 0 ? <li className="text-fg-subtle">—</li> : null}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 font-semibold text-danger">Önerilmez</p>
              <ul className="grid gap-1">
                {r.guidance.avoid.map((i) => (
                  <li key={i.key}>
                    <span className="font-medium text-fg">{i.name}</span> <span className="text-fg-subtle">· {i.why}</span>
                  </li>
                ))}
                {r.guidance.avoid.length === 0 ? <li className="text-fg-subtle">—</li> : null}
              </ul>
            </div>
          </div>
          {r.guidance.swaps.length ? <p className="text-fg-muted">Mutfak notu önerileri: {r.guidance.swaps.join(" · ")}</p> : null}
          {r.calories ? (
            <div>
              <p className="mb-1.5 font-semibold text-fg">Kaloriye göre öğün (en fazla {r.calories.maxCalories} kcal)</p>
              {r.calories.plans.length === 0 ? (
                <p className="text-fg-subtle">Plan kurulamadı — menüde kalorisi girilmiş uygun ürün yok ({r.calories.productsWithoutCalories} üründe kalori bilgisi eksik).</p>
              ) : (
                <ul className="grid gap-1">
                  {r.calories.plans.map((p, i) => (
                    <li key={i}>
                      {p.items.map((x) => `${x.name} (${x.calories} kcal)`).join(" + ")} = <span className="font-semibold text-fg">{p.totalCalories} kcal</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
