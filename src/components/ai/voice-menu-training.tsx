"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ScanSearch, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Ambiguity } from "@/lib/ai/voice-lexicon";
import { cn } from "@/lib/utils/cn";
import { buildVoiceIndexAction, testVoiceMatchAction, type VoiceMatchPreview } from "@/server/actions/voice-index.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type VoiceTrainingState = {
  status: "READY" | "STALE" | "BUILDING" | "FAILED" | "NONE";
  builtAtLabel: string | null;
  counts: { products: number; variants: number; modifiers: number; terms: number; ambiguous: number };
  ambiguities: Ambiguity[];
  aiAugmented: boolean;
};

const STATUS: Record<VoiceTrainingState["status"], { label: string; tone: string; hint: string }> = {
  NONE: { label: "Hazırlanmadı", tone: "bg-surface-2 text-fg-muted", hint: "Menünüz henüz taranmadı. Bir kez tarayın; sonra menü değiştikçe kendiliğinden güncellenir." },
  READY: { label: "Hazır", tone: "bg-success-soft text-success", hint: "Sesli garson menünüzdeki ürünleri tanımaya hazır." },
  STALE: { label: "Güncelleme gerekiyor", tone: "bg-warning-soft text-warning", hint: "Menü değişti. Dizin birkaç saniye içinde kendiliğinden yenilenir; isterseniz şimdi yeniden oluşturun." },
  BUILDING: { label: "Hazırlanıyor…", tone: "bg-surface-2 text-fg-muted", hint: "Menü taranıyor." },
  FAILED: { label: "Hata", tone: "bg-danger-soft text-danger", hint: "Tarama tamamlanamadı. Yeniden deneyin." },
};

const MATCH_TONE: Record<VoiceMatchPreview["status"], string> = {
  high: "border-success/30 bg-success-soft text-success",
  medium: "border-warning/30 bg-warning-soft text-warning",
  ambiguous: "border-warning/30 bg-warning-soft text-warning",
  sold_out: "border-border bg-surface-2 text-fg-muted",
  low: "border-border bg-surface-2 text-fg-muted",
  none: "border-danger/30 bg-danger-soft text-danger",
};
const MATCH_LABEL: Record<VoiceMatchPreview["status"], string> = { high: "Yüksek güven", medium: "Orta güven", ambiguous: "Belirsiz", sold_out: "Tükendi", low: "Düşük güven", none: "Eşleşme yok" };

export function VoiceMenuTraining({ state, readOnly }: { state: VoiceTrainingState; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [phrase, setPhrase] = useState("");
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<VoiceMatchPreview | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showAmbiguous, setShowAmbiguous] = useState(false);
  const s = STATUS[pending ? "BUILDING" : state.status];

  const scan = () =>
    start(async () => {
      setMessage(null);
      const r = await buildVoiceIndexAction();
      setMessage(r.ok ? { ok: true, text: r.message ?? "Tarama tamamlandı." } : { ok: false, text: r.error });
      router.refresh();
    });

  const test = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setTestError(null);
    try {
      const r = await testVoiceMatchAction(phrase);
      if (r.ok) setPreview(r.data);
      else {
        setPreview(null);
        setTestError(r.error);
      }
    } finally {
      setTesting(false);
    }
  };

  const stats = [
    { label: "Ürün", value: state.counts.products },
    { label: "Varyant", value: state.counts.variants },
    { label: "Ekstra / seçim", value: state.counts.modifiers },
    { label: "Üretilen söyleyiş", value: state.counts.terms },
    { label: "Belirsiz isim", value: state.counts.ambiguous },
  ];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Sesli menü dizini</CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Menünüz otomatik taranır; her ürün için Türkçe okunuşlar, yabancı ad okunuşları (ör. “Fettuccine” → “fetuçini”) ve ayırt edici kısa adlar üretilir. Telaffuz ya da takma ad girmeniz gerekmez.
              </CardDescription>
            </div>
            <span data-testid="voice-index-status" data-status={pending ? "BUILDING" : state.status} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium", s.tone)}>
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : state.status === "READY" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : state.status === "STALE" || state.status === "FAILED" ? <AlertTriangle aria-hidden="true" className="size-4" /> : null}
              {s.label}
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="text-sm text-fg-muted">
            {s.hint}
            {state.builtAtLabel ? <span className="ms-1 text-fg-subtle">Son tarama: {state.builtAtLabel}.</span> : null}
            {state.aiAugmented ? (
              <span className="ms-1 inline-flex items-center gap-1 text-fg-subtle">
                <Sparkles aria-hidden="true" className="size-3.5" /> Yapay zekâ ile doğrulanmış ek söyleyişler içerir.
              </span>
            ) : null}
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="voice-index-stats">
            {stats.map((x) => (
              <div key={x.label} className="rounded-lg border border-border bg-surface px-3 py-2.5">
                <dt className="text-xs text-fg-subtle">{x.label}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-fg">{x.value}</dd>
              </div>
            ))}
          </dl>
          {message ? (
            <p role="status" data-testid="voice-index-message" className={cn("rounded-md px-3 py-2 text-sm", message.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              {message.text}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {state.status === "NONE" ? (
              <Button type="button" onClick={scan} disabled={readOnly || pending} data-testid="voice-index-scan">
                {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ScanSearch aria-hidden="true" className="size-4" />}
                Menüyü Tara ve Sesli AI&apos;ı Hazırla
              </Button>
            ) : (
              <Button type="button" onClick={scan} disabled={readOnly || pending} data-testid="voice-index-scan" variant={state.status === "STALE" || state.status === "FAILED" ? "primary" : "secondary"}>
                {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-4" />}
                Yeniden Oluştur
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => document.getElementById("voice-test-input")?.focus()}>
              <Search aria-hidden="true" className="size-4" /> Test Et
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowAmbiguous((v) => !v)} aria-expanded={showAmbiguous} data-testid="voice-index-ambiguous-toggle">
              <AlertTriangle aria-hidden="true" className="size-4" /> Belirsiz İsimleri İncele ({state.counts.ambiguous})
            </Button>
          </div>
        </CardContent>
      </Card>

      {showAmbiguous ? (
        <Card>
          <CardHeader>
            <CardTitle>Belirsiz isimler</CardTitle>
            <CardDescription>Yalnızca çakışan ya da tek başına ürünü anlatmayan adlar listelenir. Bunlarda sesli garson tahmin yapmaz, müşteriye hangisi olduğunu sorar. Normal ürünler için işlem gerekmez.</CardDescription>
          </CardHeader>
          <CardContent>
            {state.ambiguities.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border" data-testid="voice-index-ambiguities">
                {state.ambiguities.map((a, i) => (
                  <li key={i} className="px-4 py-3 text-sm">
                    <p className="font-medium text-fg">{a.products.join(" · ")}</p>
                    <p className="mt-0.5 text-fg-subtle">{a.note}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Belirsiz isim yok — tüm ürünler ayırt edilebiliyor.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Test et</CardTitle>
          <CardDescription>Müşterinin söyleyebileceği bir ifade yazın (konuşma tanıma çıktısı gibi): “fetuçini alfredo”, “iki büyük ayran”, “çizburger orta pişmiş”.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={test} className="flex flex-wrap gap-2">
            <Input id="voice-test-input" value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={120} placeholder="ör. iki büyük ayran" className="min-w-0 flex-1" aria-label="Test ifadesi" data-testid="voice-test-input" />
            <Button type="submit" disabled={testing || !phrase.trim()} data-testid="voice-test-submit">
              {testing ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Search aria-hidden="true" className="size-4" />} Test Et
            </Button>
          </form>
          {testError ? <p className="text-sm text-danger">{testError}</p> : null}
          {preview ? (
            <div data-testid="voice-test-result" data-status={preview.status} className={cn("rounded-lg border px-4 py-3", MATCH_TONE[preview.status])}>
              <p className="text-xs font-semibold uppercase tracking-wide">{MATCH_LABEL[preview.status]}</p>
              <p className="mt-1 text-[0.9375rem] font-medium" data-testid="voice-test-reply">
                {preview.reply}
              </p>
              {preview.variant || preview.modifiers.length ? (
                <p className="mt-1 text-sm">Seçim: {[preview.variant, ...preview.modifiers].filter(Boolean).join(", ")}</p>
              ) : null}
              {preview.candidates.length ? (
                <ul className="mt-2 space-y-0.5 text-xs opacity-90">
                  {preview.candidates.map((c) => (
                    <li key={c.name}>
                      {c.name} — {Math.round(c.score * 100)}%{c.soldOut ? " (tükendi)" : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
