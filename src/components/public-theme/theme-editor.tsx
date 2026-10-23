"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { contrastRatio, isHexColor } from "@/lib/tables/contrast";
import { PUBLIC_SURFACE, WELCOME_MAX, resolvePublicTheme } from "@/lib/public-menu/theme";
import type { PublicMenuStyleKey, PublicMenuView } from "@/lib/public-menu/types";
import { applyVisibility } from "@/lib/public-menu/visibility";
import { cn } from "@/lib/utils/cn";
import { savePublicThemeAction } from "@/server/actions/public-menu.actions";
import { PublicMenu } from "@/components/public/public-menu";
import { ImageUploader } from "@/components/media/image-uploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type ThemeState = {
  style: PublicMenuStyleKey;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  heroImageUrl: string;
  welcomeText: string;
  googleReviewUrl: string;
  showNutrition: boolean;
  showAllergens: boolean;
  showIngredients: boolean;
  showPreparationTime: boolean;
  showPoweredBy: boolean;
};

const STYLES: { key: PublicMenuStyleKey; label: string; description: string }[] = [
  { key: "COMPACT", label: "Kompakt", description: "Küçük görseller, hızlı göz atma. Kalabalık menüler için." },
  { key: "VISUAL", label: "Görsel", description: "Büyük yemek fotoğrafları, kart düzeni." },
  { key: "LUXURY", label: "Lüks", description: "Bol boşluk, serif başlıklar, sade ve zarif." },
  { key: "MODERN", label: "Modern (koyu)", description: "Koyu zemin, bulanık kapak arka planı, görselli yatay kartlar. Mobil için." },
];

const TOGGLES: { key: keyof Pick<ThemeState, "showAllergens" | "showIngredients" | "showNutrition" | "showPreparationTime" | "showPoweredBy">; label: string; description?: string }[] = [
  { key: "showAllergens", label: "Alerjenleri göster", description: "Kapatılırsa “içermesin” filtresi de gizlenir." },
  { key: "showIngredients", label: "İçindekileri göster" },
  { key: "showNutrition", label: "Besin değerlerini göster" },
  { key: "showPreparationTime", label: "Hazırlık süresini göster" },
  { key: "showPoweredBy", label: "“MasaNova AI altyapısıyla” imzası" },
];

/** Yüklenen (yönetilen) logo / kapak: varsa harici adresin önüne geçer; önizleme bunu kullanır. */
export type ThemeMedia = { logoUrl: string | null; logoManaged: boolean; heroUrl: string | null; heroManaged: boolean; canUpload: boolean };

export function ThemeEditor({ view, initial, readOnly, media }: { view: PublicMenuView; initial: ThemeState; readOnly: boolean; media: ThemeMedia }) {
  const [state, setState] = useState<ThemeState>(initial);
  const frameRef = useRef<HTMLDivElement>(null);
  const set = <K extends keyof ThemeState>(key: K, value: ThemeState[K]) => setState((s) => ({ ...s, [key]: value }));
  const { state: result, pending, onSubmit } = useFormAction(savePublicThemeAction, null);
  useResultToast(result);
  const err = (k: string) => fieldError(result as ActionResult | null, k);

  // Canlı önizleme: sunucuyla AYNI tema çözümleyicisi ve görünürlük fonksiyonu.
  const preview = useMemo(() => {
    const theme = resolvePublicTheme({
      ...state,
      logoUrl: media.logoManaged ? media.logoUrl : state.logoUrl,
      heroImageUrl: media.heroManaged ? media.heroUrl : state.heroImageUrl,
      primaryColor: isHexColor(state.primaryColor) ? state.primaryColor : null,
      accentColor: isHexColor(state.accentColor) ? state.accentColor : null,
    });
    return applyVisibility({ ...view, theme }, theme.show);
  }, [state, view, media]);

  const accentAdjusted = isHexColor(state.accentColor) && contrastRatio(state.accentColor, PUBLIC_SURFACE) < 4.5;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <form onSubmit={onSubmit} noValidate className="grid content-start gap-6">
        <FormAlert state={result} />
        <fieldset disabled={readOnly} className="contents">
          <Card>
            <CardHeader>
              <CardTitle>Menü düzeni</CardTitle>
              <CardDescription>Ön tanımlı düzenlerden birini seçin; serbest CSS / HTML desteklenmez.</CardDescription>
            </CardHeader>
            <CardContent>
              <div role="radiogroup" aria-label="Menü düzeni" className="grid gap-3 sm:grid-cols-3">
                {STYLES.map((s) => (
                  <label key={s.key} className={cn("flex cursor-pointer flex-col gap-1 rounded-lg border p-4", state.style === s.key ? "border-fg bg-surface" : "border-border hover:border-border-strong")}>
                    <span className="flex items-center gap-2 font-medium">
                      <input type="radio" name="style" value={s.key} checked={state.style === s.key} onChange={() => set("style", s.key)} className="size-4 accent-primary" />
                      {s.label}
                    </span>
                    <span className="text-sm text-fg-subtle">{s.description}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Marka</CardTitle>
              <CardDescription>Renkler okunabilirlik için otomatik düzeltilir: zemin üzerinde metin her zaman en az 4,5:1 kontrastta kalır.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <ColorField id="theme-primary" name="primaryColor" label="Ana renk" hint="Masa rozeti, etkin kategori, düğmeler" value={state.primaryColor} onChange={(v) => set("primaryColor", v)} error={err("primaryColor")} />
                <ColorField id="theme-accent" name="accentColor" label="Vurgu rengi" hint="Öne çıkan ürünler, odak halkası" value={state.accentColor} onChange={(v) => set("accentColor", v)} error={err("accentColor")} />
              </div>
              {accentAdjusted ? (
                <p role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  Vurgu rengi açık zeminde okunmuyor; metinlerde otomatik olarak daha koyu bir ton kullanılıyor.
                </p>
              ) : null}
              <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <ImageUploader
                  kind="LOGO"
                  label="Logo"
                  testId="logo-uploader"
                  currentUrl={media.logoManaged ? media.logoUrl : null}
                  removeBody={media.logoManaged ? {} : undefined}
                  disabled={readOnly || !media.canUpload}
                />
                <ImageUploader
                  kind="HERO"
                  label="Kapak görseli"
                  testId="hero-uploader"
                  currentUrl={media.heroManaged ? media.heroUrl : null}
                  removeBody={media.heroManaged ? {} : undefined}
                  disabled={readOnly || !media.canUpload}
                />
              </div>
              {/* Asıl yol dosya yüklemek. Harici https adresi (geriye uyumluluk) yalnızca yüklenmiş görsel YOKSA kullanılır ve
                  "Bağlantıyla ekle" altında durur; zaten bir adres girilmişse açık gelir. */}
              {media.logoManaged && media.heroManaged ? null : (
              <details className="group rounded-xl border border-stone-900/[0.06] bg-white/40 px-4 py-3" open={!!(state.logoUrl || state.heroImageUrl)}>
                <summary className="cursor-pointer text-sm font-medium text-stone-600 marker:text-stone-400">Bağlantıyla ekle (isteğe bağlı)</summary>
                <div className="mt-3 grid gap-4">
              {media.logoManaged ? (
                <input type="hidden" name="logoUrl" value="" />
              ) : (
                <Field id="theme-logo" label="veya logo adresi (https)" error={err("logoUrl")} hint="İsteğe bağlı; yükleme varsa kullanılmaz.">
                  <Input id="theme-logo" name="logoUrl" type="url" value={state.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} aria-describedby={describedBy("theme-logo", { hint: true, error: err("logoUrl") })} />
                </Field>
              )}
              {media.heroManaged ? (
                <input type="hidden" name="heroImageUrl" value="" />
              ) : (
                <Field id="theme-hero" label="veya kapak görseli adresi (https)" error={err("heroImageUrl")} hint="İsteğe bağlı. Kapak yoksa marka renginde zarif bir geçiş kullanılır.">
                  <Input id="theme-hero" name="heroImageUrl" type="url" value={state.heroImageUrl} onChange={(e) => set("heroImageUrl", e.target.value)} aria-describedby={describedBy("theme-hero", { hint: true, error: err("heroImageUrl") })} />
                </Field>
              )}
                </div>
              </details>
              )}
              {media.logoManaged && media.heroManaged ? (
                <>
                  <input type="hidden" name="logoUrl" value="" />
                  <input type="hidden" name="heroImageUrl" value="" />
                </>
              ) : null}
              <Field id="theme-welcome" label="Karşılama metni" error={err("welcomeText")} hint={`${state.welcomeText.length} / ${WELCOME_MAX} — düz metin`}>
                <Textarea id="theme-welcome" name="welcomeText" rows={2} maxLength={WELCOME_MAX} value={state.welcomeText} onChange={(e) => set("welcomeText", e.target.value)} aria-describedby={describedBy("theme-welcome", { hint: true, error: err("welcomeText") })} />
              </Field>
              <Field id="theme-review" label="Google yorum bağlantısı" error={err("googleReviewUrl")} hint="Menüdeki “Google Yorum” sekmesi bu adresi açar (https Google bağlantısı). Boşsa işletmenin Google Haritalar araması açılır.">
                <Input id="theme-review" name="googleReviewUrl" type="url" value={state.googleReviewUrl} onChange={(e) => set("googleReviewUrl", e.target.value)} placeholder="https://g.page/r/…/review" aria-describedby={describedBy("theme-review", { hint: true, error: err("googleReviewUrl") })} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Görünürlük</CardTitle>
              <CardDescription>Alerjen, diyet ve besin bilgileri menüde “işletmenin beyanı” olarak gösterilir.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {TOGGLES.map((t) => (
                <Checkbox key={t.key} id={`theme-${t.key}`} name={t.key} label={t.label} description={t.description} checked={state[t.key]} onChange={(e) => set(t.key, e.target.checked)} />
              ))}
            </CardContent>
          </Card>
        </fieldset>
        {!readOnly ? (
          <div className="flex justify-end">
            <Button type="submit" loading={pending}>
              Görünümü kaydet
            </Button>
          </div>
        ) : null}
      </form>

      <aside aria-label="Canlı telefon önizlemesi" className="xl:sticky xl:top-20 xl:self-start">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Canlı önizleme</span>
          <span className="text-fg-subtle">{view.branch?.name ?? "Şube yok"}</span>
        </div>
        <div className="mx-auto w-full max-w-[24.5rem] rounded-[2.75rem] bg-stone-900 p-2.5 shadow-xl">
          <div ref={frameRef} data-testid="theme-preview" className="relative h-[46rem] max-h-[75dvh] overflow-y-auto overscroll-contain rounded-[2.25rem] bg-[#faf8f5] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <PublicMenu view={preview} preview scrollRoot={frameRef} />
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-fg-subtle">Önizleme gerçek menünüzü gösterir; masa bilgisi yerine “Önizleme” yazar. Gerçek masa deneyimi için Masalar sayfasından bir QR adresini açın.</p>
      </aside>
    </div>
  );
}

function ColorField({ id, name, label, hint, value, onChange, error }: { id: string; name: string; label: string; hint: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${label} seçici`}
          value={isHexColor(value) ? value : "#1c1917"}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-border-strong bg-bg p-1"
        />
        <Input id={id} name={name} value={value} placeholder="#RRGGBB" maxLength={7} onChange={(e) => onChange(e.target.value)} className="font-mono" aria-describedby={describedBy(id, { hint: true, error })} />
      </div>
    </Field>
  );
}
