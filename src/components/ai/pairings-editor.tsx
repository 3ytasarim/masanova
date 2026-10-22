"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { PairingView } from "@/lib/ai/pairings";
import type { GeneratePairingsResult, PairingsState } from "@/server/actions/pairings.actions";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Textarea } from "@/components/ui/textarea";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

const PLACEHOLDER = `Her satır bir ana yemek: Ana yemek | Mezeler | İçecekler

Levrek Izgara | Deniz Börülcesi, Fava | Çankaya Beyaz Şarap
Çipura Izgara | Haydari, Roka Salata | Angora Beyaz
Palamut Izgara | Acılı Ezme, Patlıcan Söğürme | Tekirdağ Rakı

Bir tablodan (Excel, Word, sohbet) kopyalayıp doğrudan yapıştırabilirsiniz.`;

/** Eşleştirme metni + kaydedilmiş tablo. Kaydedince adlar menüye çözülür; bulunamayanlar listelenir. */
export function PairingsEditor({
  action,
  generate,
  initialText,
  initialViews,
  readOnly,
}: {
  action: (s: PairingsState, fd: FormData) => Promise<PairingsState>;
  generate: () => Promise<GeneratePairingsResult>;
  initialText: string;
  initialViews: PairingView[];
  readOnly: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  const plain = state as unknown as ActionResult | null;
  useResultToast(plain);
  const [text, setText] = useState(initialText);
  const [generating, startGenerate] = useTransition();
  const [draft, setDraft] = useState<{ views: PairingView[]; message: string } | { error: string } | null>(null);
  const draftViews = draft && "views" in draft ? draft.views : null;
  // Taslak (yapay zekâ önerisi) varsa onu göster; kaydedince kaydedilmiş hâl gelir.
  const views = state?.ok ? state.data.views : (draftViews ?? initialViews);
  const unmatched = state?.ok ? state.data.unmatched : [];

  const onGenerate = () =>
    startGenerate(async () => {
      const r = await generate();
      if (r.ok) {
        setText(r.data.text);
        setDraft({ views: r.data.views, message: r.message ?? "" });
      } else setDraft({ error: r.error });
    });

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-orange-200/70 bg-[linear-gradient(135deg,rgb(255_247_237/0.9),rgb(254_242_242/0.7))] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-900">Yapay zekâ menünüze göre hazırlasın</p>
          <p className="mt-0.5 text-[0.8125rem] text-stone-600">Menünüzdeki her ana yemek için uyumlu meze, içecek ve tatlı önerir; yalnızca menünüzdeki ürünleri kullanır. Kaydetmeden önce düzenleyebilirsiniz.</p>
        </div>
        <Button type="button" onClick={onGenerate} loading={generating} disabled={readOnly || generating} data-testid="pairings-generate" className="shrink-0">
          <Sparkles aria-hidden="true" /> Yapay zekayla oluştur
        </Button>
      </div>
      {draft ? (
        <p role="status" data-testid="pairings-draft" className={"error" in draft ? "rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger" : "rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"}>
          {"error" in draft ? draft.error : `${draft.message} Öneriler henüz KAYDEDİLMEDİ.`}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="grid gap-4" data-testid="pairings-form">
        <FormAlert state={plain} />
        <Field id="pairings-text" label="Eşleştirmeler" hint="Her satır: Ana yemek | Mezeler | İçecekler | Tatlı (virgülle ayırın; tatlı isteğe bağlı). Adlar menünüzdeki ürünlerle eşleştirilir.">
          <Textarea
            id="pairings-text"
            name="text"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            disabled={readOnly}
            className="font-mono text-[0.875rem]"
            aria-describedby={describedBy("pairings-text", { hint: true })}
          />
        </Field>
        <div>
          <Button type="submit" loading={pending} disabled={readOnly} data-testid="pairings-save">
            Kaydet ve menüyle eşleştir
          </Button>
        </div>
      </form>

      {unmatched.length ? (
        <div role="status" className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning" data-testid="pairings-unmatched">
          <p className="font-semibold">Menüde bulunamayan adlar (kaydedilmedi):</p>
          <ul className="mt-1 list-disc pl-5">
            {unmatched.map((u, i) => (
              <li key={i}>
                {u.line}. satır: <span className="font-medium">{u.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Adı menüdeki ürün adıyla aynı yazın ya da ürünü menüye ekleyin.</p>
        </div>
      ) : null}

      <section aria-label="Kayıtlı eşleştirmeler" data-testid="pairings-table">
        <h2 className="mb-3 text-[0.9375rem] font-semibold text-fg">Garsonun söyleyeceği eşleştirmeler ({views.length})</h2>
        {views.length === 0 ? (
          <p className="text-sm text-fg-subtle">Henüz eşleştirme yok. Eklemezseniz garson menünüzden kendi önerisini yapar.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Ana yemek</TH>
                <TH>Önerilecek meze</TH>
                <TH>İçecek eşleştirmesi</TH>
                <TH>Tatlı</TH>
              </TR>
            </THead>
            <TBody>
              {views.map((v) => (
                <TR key={v.main}>
                  <TD label="Ana yemek" className="font-medium text-fg">
                    {v.main}
                  </TD>
                  <TD label="Önerilecek meze">{v.sides.map((s) => s.name).join(", ") || "—"}</TD>
                  <TD label="İçecek eşleştirmesi">{v.drinks.map((d) => d.name).join(", ") || "—"}</TD>
                  <TD label="Tatlı">{v.desserts.map((d) => d.name).join(", ") || "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
