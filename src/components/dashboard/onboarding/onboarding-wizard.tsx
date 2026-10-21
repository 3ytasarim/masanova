"use client";

import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
import { FEATURE_LABELS, PLANS, PLAN_ORDER } from "@/config/plans";
import { buildSubdomainHostname, formatTenantAddress, getTenantUrl } from "@/lib/domain/get-tenant-url";
import type { LocaleOptions } from "@/lib/validation/intl";
import { slugify } from "@/lib/utils/slugify";
import { cn } from "@/lib/utils/cn";
import {
  branchFieldsSchema,
  brandingSchema,
  businessStepSchema,
  domainStepSchema,
  ownerStepSchema,
  planSchema,
  type OnboardingInput,
} from "@/lib/validation/tenant";
import {
  checkDomainAvailabilityAction,
  checkOwnerEmailAction,
  checkSlugAvailabilityAction,
  createTenantAction,
  type AvailabilityResult,
} from "@/server/actions/onboarding.actions";
import type { OnboardingResult } from "@/server/services/onboarding.service";
import { BranchFields, branchFormValues } from "@/components/dashboard/branch-fields";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type WizardData = {
  business: { name: string; slug: string };
  branch: ReturnType<typeof branchFormValues>;
  domain: { subdomain: string; customDomain: string };
  owner: { firstName: string; lastName: string; email: string; passwordMode: "generate" | "manual"; password: string };
  branding: { logoUrl: string; primaryColor: string; secondaryColor: string; accentColor: string };
  plan: "STARTER" | "VOICE_MENU" | "PRO" | "AI";
};

const INITIAL: WizardData = {
  business: { name: "", slug: "" },
  branch: {
    name: "Merkez Şube", slug: "merkez", phone: "", email: "", country: "TR", city: "", district: "", address: "",
    // Sihirbaz varsayılanları (Türkiye'deki işletmeler için) — sistem geneli varsayılan değildir.
    timezone: "Europe/Istanbul", currency: "TRY", locale: "tr",
  },
  domain: { subdomain: "", customDomain: "" },
  owner: { firstName: "", lastName: "", email: "", passwordMode: "generate", password: "" },
  branding: { logoUrl: "", primaryColor: "", secondaryColor: "", accentColor: "" },
  plan: "AI",
};

const STEPS = [
  { key: "business", label: "İşletme" },
  { key: "branch", label: "Şube" },
  { key: "domain", label: "Alan adı" },
  { key: "owner", label: "Sahip" },
  { key: "branding", label: "Marka" },
  { key: "plan", label: "Paket" },
  { key: "review", label: "Özet" },
] as const;

type Errors = Record<string, string>;

function zodErrors(error: z.ZodError, prefix: string): Errors {
  const out: Errors = {};
  for (const issue of error.issues) {
    const key = [prefix, ...issue.path].join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function sub(errors: Errors, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  return out;
}

function toPayload(data: WizardData): OnboardingInput {
  return {
    business: data.business,
    branch: data.branch,
    domain: { subdomain: data.domain.subdomain, customDomain: data.domain.customDomain },
    owner:
      data.owner.passwordMode === "manual"
        ? { passwordMode: "manual", firstName: data.owner.firstName, lastName: data.owner.lastName, email: data.owner.email, password: data.owner.password }
        : { passwordMode: "generate", firstName: data.owner.firstName, lastName: data.owner.lastName, email: data.owner.email },
    branding: data.branding,
    plan: data.plan,
  };
}

export function OnboardingWizard({ options }: { options: LocaleOptions }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Adım değişince odağı adım başlığına taşı (ekran okuyucu yeni adımı duyurur).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, result]);

  function goTo(next: number) {
    setErrors({});
    setFormError(null);
    setStep(next);
  }

  /** Adım doğrulaması: önce Zod (istemci), gerekiyorsa sunucuda benzersizlik. */
  function advance(update: Partial<WizardData>, validate: (merged: WizardData) => Promise<Errors> | Errors) {
    const merged = { ...data, ...update };
    setData(merged);
    startTransition(async () => {
      const found = await validate(merged);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        setFormError("Lütfen işaretli alanları düzeltin.");
        return;
      }
      goTo(step + 1);
    });
  }

  function submit() {
    setFormError(null);
    startTransition(async () => {
      const response = await createTenantAction(toPayload(data));
      if (response.ok) {
        setResult(response.data);
        return;
      }
      setFormError(response.error);
      const fieldErrors = response.fieldErrors ?? {};
      setErrors(fieldErrors);
      const firstKey = Object.keys(fieldErrors)[0];
      const target = firstKey ? STEPS.findIndex((s) => firstKey.startsWith(`${s.key}.`)) : -1;
      if (target >= 0) setStep(target);
    });
  }

  if (result) {
    return (
      <SuccessScreen
        result={result}
        headingRef={headingRef}
        onRestart={() => {
          setResult(null);
          setData(INITIAL);
          goTo(0);
        }}
      />
    );
  }

  const current = STEPS[step]!;

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <Stepper step={step} onSelect={(i) => i < step && goTo(i)} />

      <section aria-labelledby="wizard-step-title" className="min-w-0 rounded-xl border border-border bg-bg shadow-xs">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Adım {step + 1} / {STEPS.length}
          </p>
          <h2 id="wizard-step-title" ref={headingRef} tabIndex={-1} className="mt-1 text-lg font-semibold tracking-tight outline-none">
            {STEP_TITLES[current.key]}
          </h2>
        </div>

        <div className="px-5 py-6 sm:px-6">
          {formError ? (
            <p role="alert" className="mb-5 rounded-md border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger">
              {formError}
            </p>
          ) : null}

          {current.key === "business" ? (
            <BusinessStep
              data={data.business}
              errors={sub(errors, "business")}
              onNext={(business) =>
                advance({ business, domain: data.domain.subdomain ? data.domain : { ...data.domain, subdomain: business.slug } }, async () => {
                  const parsed = businessStepSchema.safeParse(business);
                  if (!parsed.success) return zodErrors(parsed.error, "business");
                  const check = await checkSlugAvailabilityAction(parsed.data.slug);
                  return check.available ? {} : { "business.slug": check.message };
                })
              }
            />
          ) : null}

          {current.key === "branch" ? (
            <StepForm
              onSubmit={(fd) =>
                advance({ branch: branchFormValues(fd) }, (merged) => {
                  const parsed = branchFieldsSchema.safeParse(merged.branch);
                  return parsed.success ? {} : zodErrors(parsed.error, "branch");
                })
              }
            >
              <BranchFields idPrefix="wz-branch" defaults={data.branch} options={options} errors={sub(errors, "branch")} />
            </StepForm>
          ) : null}

          {current.key === "domain" ? (
            <DomainStep
              data={data.domain}
              errors={sub(errors, "domain")}
              onNext={(domain) =>
                advance({ domain }, async () => {
                  const parsed = domainStepSchema.safeParse(domain);
                  if (!parsed.success) return zodErrors(parsed.error, "domain");
                  const [subCheck, customCheck] = await Promise.all([
                    checkDomainAvailabilityAction("subdomain", parsed.data.subdomain),
                    parsed.data.customDomain ? checkDomainAvailabilityAction("custom", parsed.data.customDomain) : Promise.resolve<AvailabilityResult>({ available: true, message: "" }),
                  ]);
                  const out: Errors = {};
                  if (!subCheck.available) out["domain.subdomain"] = subCheck.message;
                  if (!customCheck.available) out["domain.customDomain"] = customCheck.message;
                  return out;
                })
              }
            />
          ) : null}

          {current.key === "owner" ? (
            <OwnerStep
              data={data.owner}
              errors={sub(errors, "owner")}
              onNext={(owner) =>
                advance({ owner }, async (merged) => {
                  const parsed = ownerStepSchema.safeParse(toPayload(merged).owner);
                  if (!parsed.success) return zodErrors(parsed.error, "owner");
                  const check = await checkOwnerEmailAction(parsed.data.email);
                  return check.available ? {} : { "owner.email": check.message };
                })
              }
            />
          ) : null}

          {current.key === "branding" ? (
            <BrandingStep
              data={data.branding}
              errors={sub(errors, "branding")}
              onNext={(branding) =>
                advance({ branding }, () => {
                  const parsed = brandingSchema.safeParse(branding);
                  return parsed.success ? {} : zodErrors(parsed.error, "branding");
                })
              }
            />
          ) : null}

          {current.key === "plan" ? (
            <PlanStep
              value={data.plan}
              error={errors.plan}
              onNext={(plan) =>
                advance({ plan }, (): Errors => {
                  const parsed = planSchema.safeParse(plan);
                  return parsed.success ? {} : { plan: parsed.error.issues[0]?.message ?? "Geçersiz." };
                })
              }
            />
          ) : null}

          {current.key === "review" ? <ReviewStep data={data} countries={options.countries} onEdit={(i) => goTo(i)} /> : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:justify-between sm:px-6">
          <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={step === 0 || pending}>
            Geri
          </Button>
          {current.key === "review" ? (
            <Button onClick={submit} loading={pending}>
              İşletmeyi oluştur
            </Button>
          ) : (
            <Button type="submit" form="wizard-step-form" loading={pending}>
              Devam
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

const STEP_TITLES: Record<(typeof STEPS)[number]["key"], string> = {
  business: "İşletme bilgileri",
  branch: "Ana şube",
  domain: "Alan adı",
  owner: "İşletme sahibi hesabı",
  branding: "Marka (isteğe bağlı)",
  plan: "Paket",
  review: "Özet ve onay",
};

function Stepper({ step, onSelect }: { step: number; onSelect: (i: number) => void }) {
  return (
    <nav aria-label="Oluşturma adımları">
      <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.key} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(i)}
                disabled={!done}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors",
                  active && "bg-bg font-medium text-fg shadow-xs ring-1 ring-border",
                  done && "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  !done && !active && "text-fg-subtle",
                  "disabled:cursor-default",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                    active && "border-fg bg-primary text-primary-fg",
                    done && "border-success/40 bg-success-soft text-success",
                    !done && !active && "border-border-strong",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="whitespace-nowrap">{s.label}</span>
                {done ? <span className="sr-only">(tamamlandı)</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Her adım kendi formu: Enter "Devam" ile aynı; alt çubuktaki düğme form="wizard-step-form" ile gönderir. */
function StepForm({ onSubmit, children }: { onSubmit: (formData: FormData) => void; children: ReactNode }) {
  return (
    <form
      id="wizard-step-form"
      noValidate
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
    >
      {children}
    </form>
  );
}

/** Modül düzeyinde (kararlı referans): useAvailability efekti yalnızca değer değişince çalışsın. */
const checkSubdomainAvailability = (value: string) => checkDomainAvailabilityAction("subdomain", value);

function useAvailability(check: (value: string) => Promise<AvailabilityResult>, value: string, enabled: boolean) {
  const [state, setState] = useState<{ value: string; result: AvailabilityResult } | null>(null);
  useEffect(() => {
    if (!enabled || !value) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await check(value);
      if (!cancelled) setState({ value, result });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [check, value, enabled]);
  return enabled && value && state?.value === value ? state.result : null;
}

function AvailabilityHint({ id, result, base }: { id: string; result: AvailabilityResult | null; base: ReactNode }) {
  return (
    <p id={`${id}-hint`} aria-live="polite" className="text-[0.8125rem] text-fg-subtle">
      {result ? (
        <span className={result.available ? "text-success" : "text-danger"}>{result.message}</span>
      ) : (
        base
      )}
    </p>
  );
}

function BusinessStep({ data, errors, onNext }: { data: WizardData["business"]; errors: Record<string, string>; onNext: (v: WizardData["business"]) => void }) {
  const [name, setName] = useState(data.name);
  const [slug, setSlug] = useState(data.slug);
  const [touched, setTouched] = useState(data.slug !== "" && data.slug !== slugify(data.name));
  const effectiveSlug = touched ? slug : slugify(name);
  const availability = useAvailability(checkSlugAvailabilityAction, effectiveSlug, effectiveSlug.length >= 2);

  return (
    <StepForm onSubmit={() => onNext({ name: name.trim(), slug: effectiveSlug })}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="wz-name" label="İşletme adı" required error={errors.name}>
          <Input
            id="wz-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            autoFocus
            placeholder="Beyoğlu Çorbacısı"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("wz-name", { error: errors.name })}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="wz-slug" className="text-sm font-medium text-fg">
            Kısa ad (slug)<span className="ml-0.5 text-danger" aria-hidden="true">*</span>
          </label>
          <Input
            id="wz-slug"
            value={effectiveSlug}
            onChange={(e) => {
              setTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            maxLength={63}
            required
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
            aria-invalid={errors.slug || (availability && !availability.available) ? true : undefined}
            aria-describedby={errors.slug ? "wz-slug-error" : "wz-slug-hint"}
          />
          {errors.slug ? (
            <p id="wz-slug-error" className="text-[0.8125rem] text-danger">
              {errors.slug}
            </p>
          ) : (
            <AvailabilityHint id="wz-slug" result={availability} base="İşletme adından önerilir. Küçük harf, rakam ve tire." />
          )}
        </div>
      </div>
    </StepForm>
  );
}

function DomainStep({ data, errors, onNext }: { data: WizardData["domain"]; errors: Record<string, string>; onNext: (v: WizardData["domain"]) => void }) {
  const [subdomain, setSubdomain] = useState(data.subdomain);
  const [useCustom, setUseCustom] = useState(!!data.customDomain);
  const [customDomain, setCustomDomain] = useState(data.customDomain);
  const subAvailability = useAvailability(checkSubdomainAvailability, subdomain, subdomain.length >= 2);
  const preview = subdomain ? formatTenantAddress(buildSubdomainHostname(subdomain)) : "…";

  return (
    <StepForm onSubmit={() => onNext({ subdomain: subdomain.trim().toLowerCase(), customDomain: useCustom ? customDomain.trim() : "" })}>
      <fieldset className="grid gap-5">
        <legend className="sr-only">Alan adı türü</legend>
        <div className="rounded-lg border border-fg/20 bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Platform alt alan adı</h3>
            <Badge tone="success">Varsayılan · hemen aktif</Badge>
          </div>
          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="wz-sub" className="text-sm font-medium">
              Alt alan adı<span className="ml-0.5 text-danger" aria-hidden="true">*</span>
            </label>
            <Input
              id="wz-sub"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
              maxLength={63}
              className="font-mono"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={errors.subdomain ? true : undefined}
              aria-describedby={errors.subdomain ? "wz-sub-error" : "wz-sub-hint"}
            />
            {errors.subdomain ? (
              <p id="wz-sub-error" className="text-[0.8125rem] text-danger">
                {errors.subdomain}
              </p>
            ) : (
              <AvailabilityHint id="wz-sub" result={subAvailability} base="Varsayılan olarak kısa ad kullanılır." />
            )}
          </div>
          <p className="mt-3 text-sm text-fg-muted">
            Adres önizlemesi: <span className="break-all font-mono font-medium text-fg">{preview}</span>
          </p>
        </div>

        <div className="rounded-lg border border-border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} className="mt-0.5 size-[18px] accent-primary" />
            <span>
              <span className="block text-sm font-semibold">Özel alan adı da ekle</span>
              <span className="block text-[0.8125rem] text-fg-subtle">Örn. menu.restoran.com, qr.restoran.com</span>
            </span>
          </label>
          {useCustom ? (
            <div className="mt-4 grid gap-3">
              <Field id="wz-custom" label="Özel alan adı" error={errors.customDomain}>
                <Input
                  id="wz-custom"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="menu.restoran.com"
                  className="font-mono"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={errors.customDomain ? true : undefined}
                  aria-describedby={describedBy("wz-custom", { error: errors.customDomain })}
                />
              </Field>
              <p className="flex gap-2 rounded-md bg-warning-soft px-3 py-2.5 text-[0.8125rem] text-warning">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  Özel alan adı <strong className="font-semibold">DNS doğrulaması</strong> tamamlanana kadar yayına çıkmaz. Oluşturma sonrası
                  İşletme › Domainler sekmesinde TXT kaydı talimatı ve “Doğrulamayı kontrol et” düğmesi bulunur.
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </fieldset>
    </StepForm>
  );
}

function OwnerStep({ data, errors, onNext }: { data: WizardData["owner"]; errors: Record<string, string>; onNext: (v: WizardData["owner"]) => void }) {
  const [mode, setMode] = useState(data.passwordMode);
  const groupId = useId();
  return (
    <StepForm
      onSubmit={(fd) =>
        onNext({
          firstName: String(fd.get("firstName") ?? ""),
          lastName: String(fd.get("lastName") ?? ""),
          email: String(fd.get("email") ?? ""),
          passwordMode: mode,
          password: mode === "manual" ? String(fd.get("password") ?? "") : "",
        })
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="wz-first" label="Ad" required error={errors.firstName}>
          <Input id="wz-first" name="firstName" defaultValue={data.firstName} maxLength={80} autoComplete="off" aria-invalid={errors.firstName ? true : undefined} aria-describedby={describedBy("wz-first", { error: errors.firstName })} />
        </Field>
        <Field id="wz-last" label="Soyad" required error={errors.lastName}>
          <Input id="wz-last" name="lastName" defaultValue={data.lastName} maxLength={80} autoComplete="off" aria-invalid={errors.lastName ? true : undefined} aria-describedby={describedBy("wz-last", { error: errors.lastName })} />
        </Field>
        <Field id="wz-email" label="E-posta (giriş adı)" required error={errors.email} className="md:col-span-2">
          <Input id="wz-email" name="email" type="email" defaultValue={data.email} maxLength={254} autoComplete="off" aria-invalid={errors.email ? true : undefined} aria-describedby={describedBy("wz-email", { error: errors.email })} />
        </Field>
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium" id={groupId}>
          İlk parola
        </legend>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(
            [
              ["generate", "Geçici parola üret", "Güçlü bir parola üretilir ve yalnızca bir kez gösterilir. Önerilen."],
              ["manual", "Parolayı ben belirleyeceğim", "En az 12 karakter."],
            ] as const
          ).map(([value, title, desc]) => (
            <label
              key={value}
              className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors", mode === value ? "border-fg bg-surface" : "border-border hover:border-border-strong")}
            >
              <input type="radio" name="passwordMode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-[0.8125rem] text-fg-subtle">{desc}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === "manual" ? (
          <Field id="wz-password" label="Parola" required error={errors.password} hint="En az 12 karakter. Parola hiçbir yerde düz metin olarak saklanmaz." className="mt-4 max-w-md">
            <Input id="wz-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} aria-invalid={errors.password ? true : undefined} aria-describedby={describedBy("wz-password", { hint: true, error: errors.password })} />
          </Field>
        ) : null}
        <p className="mt-4 text-[0.8125rem] text-fg-subtle">E-posta ile bilgilendirme sonraki sprintte; giriş bilgilerini işletme sahibine güvenli bir kanaldan iletin.</p>
      </fieldset>
    </StepForm>
  );
}

function ColorInput({ id, name, label, defaultValue, error }: { id: string; name: string; label: string; defaultValue: string; error?: string }) {
  const [value, setValue] = useState(defaultValue);
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <Field id={id} label={label} error={error} hint="#RRGGBB — boş bırakılabilir">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} seçici`}
          value={valid ? value : "#000000"}
          onChange={(e) => setValue(e.target.value)}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-border-strong bg-bg p-1"
        />
        <Input id={id} name={name} value={value} onChange={(e) => setValue(e.target.value)} placeholder="#18181b" maxLength={7} className="font-mono" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { hint: true, error })} />
      </div>
    </Field>
  );
}

function BrandingStep({ data, errors, onNext }: { data: WizardData["branding"]; errors: Record<string, string>; onNext: (v: WizardData["branding"]) => void }) {
  return (
    <StepForm
      onSubmit={(fd) =>
        onNext({
          logoUrl: String(fd.get("logoUrl") ?? ""),
          primaryColor: String(fd.get("primaryColor") ?? ""),
          secondaryColor: String(fd.get("secondaryColor") ?? ""),
          accentColor: String(fd.get("accentColor") ?? ""),
        })
      }
    >
      <div className="grid gap-5 md:grid-cols-3">
        <Field id="wz-logo" label="Logo adresi (URL)" error={errors.logoUrl} hint="İsteğe bağlı https adresi. Kurulumdan sonra logoyu Tema & Tasarım sayfasından bilgisayardan da yükleyebilirsiniz." className="md:col-span-3">
          <Input id="wz-logo" name="logoUrl" type="url" defaultValue={data.logoUrl} placeholder="https://…/logo.png" aria-invalid={errors.logoUrl ? true : undefined} aria-describedby={describedBy("wz-logo", { hint: true, error: errors.logoUrl })} />
        </Field>
        <ColorInput id="wz-primary" name="primaryColor" label="Ana renk" defaultValue={data.primaryColor} error={errors.primaryColor} />
        <ColorInput id="wz-secondary" name="secondaryColor" label="İkincil renk" defaultValue={data.secondaryColor} error={errors.secondaryColor} />
        <ColorInput id="wz-accent" name="accentColor" label="Vurgu rengi" defaultValue={data.accentColor} error={errors.accentColor} />
      </div>
    </StepForm>
  );
}

function PlanStep({ value, error, onNext }: { value: WizardData["plan"]; error?: string; onNext: (v: WizardData["plan"]) => void }) {
  const [plan, setPlan] = useState(value);
  return (
    <StepForm onSubmit={() => onNext(plan)}>
      <fieldset>
        <legend className="sr-only">Paket seçimi</legend>
        {error ? (
          <p role="alert" className="mb-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          {PLAN_ORDER.map((key) => {
            const p = PLANS[key];
            const selected = plan === key;
            return (
              <label key={key} className={cn("flex cursor-pointer flex-col rounded-lg border p-4 transition-colors", selected ? "border-fg bg-surface shadow-xs" : "border-border hover:border-border-strong")}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="plan" value={key} checked={selected} onChange={() => setPlan(key)} className="size-4 accent-primary" />
                  <span className="font-semibold">{p.label}</span>
                </span>
                <span className="mt-1.5 text-[0.8125rem] text-fg-subtle">{p.description}</span>
                <ul className="mt-3 grid gap-1.5 text-sm text-fg-muted">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check aria-hidden="true" className="size-3.5 text-success" />
                      {FEATURE_LABELS[f]}
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </div>
        <p className="mt-4 text-[0.8125rem] text-fg-subtle">Faturalama bu sprintte yok; paket yalnızca atanır. Özellikler ilgili sprintlerde devreye girecek.</p>
      </fieldset>
    </StepForm>
  );
}

function ReviewRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="text-sm text-fg-subtle sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-fg">{value || <span className="text-fg-subtle">—</span>}</dd>
    </div>
  );
}

function ReviewStep({ data, countries, onEdit }: { data: WizardData; countries: LocaleOptions["countries"]; onEdit: (step: number) => void }) {
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const section = (title: string, step: number, rows: [string, ReactNode][]) => (
    <section className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button variant="ghost" size="sm" onClick={() => onEdit(step)}>
          Düzenle<span className="sr-only">: {title}</span>
        </Button>
      </div>
      <dl className="divide-y divide-border px-4">
        {rows.map(([label, value]) => (
          <ReviewRow key={label} label={label} value={value} />
        ))}
      </dl>
    </section>
  );
  const b = data.branch;
  return (
    <div className="grid gap-4">
      {section("İşletme", 0, [["Ad", data.business.name], ["Kısa ad", <code key="s" className="font-mono">{data.business.slug}</code>], ["Başlangıç durumu", "Deneme (TRIAL)"]])}
      {section("Şube", 1, [
        ["Ad", `${b.name} (${b.slug})`],
        ["İletişim", [b.phone, b.email].filter(Boolean).join(" · ")],
        ["Konum", [b.address, b.district, b.city, countryName(b.country)].filter(Boolean).join(", ")],
        ["Yerel ayarlar", `${b.timezone} · ${b.currency} · ${b.locale}`],
      ])}
      {section("Alan adı", 2, [
        ["Alt alan adı", <span key="d" className="font-mono">{formatTenantAddress(buildSubdomainHostname(data.domain.subdomain))}</span>],
        ["Özel alan adı", data.domain.customDomain ? <span key="c"><span className="font-mono">{data.domain.customDomain}</span> <Badge tone="warning">DNS doğrulaması bekleyecek</Badge></span> : ""],
      ])}
      {section("Sahip", 3, [
        ["Ad soyad", `${data.owner.firstName} ${data.owner.lastName}`],
        ["E-posta", data.owner.email],
        ["Parola", data.owner.passwordMode === "generate" ? "Geçici parola üretilecek (bir kez gösterilir)" : "Elle belirlendi"],
      ])}
      {section("Marka", 4, [
        ["Logo", data.branding.logoUrl],
        [
          "Renkler",
          [data.branding.primaryColor, data.branding.secondaryColor, data.branding.accentColor].some(Boolean) ? (
            <span key="c" className="flex flex-wrap gap-2">
              {[data.branding.primaryColor, data.branding.secondaryColor, data.branding.accentColor].filter(Boolean).map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 font-mono text-xs">
                  <span aria-hidden="true" className="size-4 rounded-sm border border-border" style={{ background: c }} /> {c}
                </span>
              ))}
            </span>
          ) : (
            ""
          ),
        ],
      ])}
      {section("Paket", 5, [["Paket", PLANS[data.plan].label]])}
      <p className="text-[0.8125rem] text-fg-subtle">
        “İşletmeyi oluştur” tüm kayıtları tek bir veritabanı işleminde oluşturur; herhangi bir adım başarısız olursa hiçbir kayıt oluşmaz.
      </p>
    </div>
  );
}

function SuccessScreen({
  result,
  headingRef,
  onRestart,
}: {
  result: OnboardingResult;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onRestart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => headingRef.current?.focus(), [headingRef]);

  async function copy() {
    if (!result.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="success-title" className="mx-auto max-w-2xl rounded-xl border border-border bg-bg shadow-xs">
      <div className="px-6 pb-2 pt-8 text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-success-soft">
          <Check aria-hidden="true" className="size-6 text-success" />
        </span>
        <h2 id="success-title" ref={headingRef} tabIndex={-1} className="mt-4 text-xl font-semibold tracking-tight outline-none">
          İşletme başarıyla oluşturuldu.
        </h2>
      </div>

      <dl className="mx-6 my-5 divide-y divide-border rounded-lg border border-border px-4">
        <ReviewRow label="İşletme" value={result.tenantName} />
        <ReviewRow label="Tenant ID" value={<code className="font-mono text-xs">{result.tenantId}</code>} />
        <ReviewRow label="Ana şube" value={result.branchName} />
        <ReviewRow
          label="Alt alan adı"
          value={
            <a href={getTenantUrl(result.subdomain)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">
              {formatTenantAddress(result.subdomain)}
            </a>
          }
        />
        {result.customDomain ? <ReviewRow label="Özel alan adı" value={<span><span className="font-mono">{result.customDomain}</span> <Badge tone="warning">DNS doğrulaması bekliyor</Badge></span>} /> : null}
        <ReviewRow label="Sahip e-postası" value={result.ownerEmail} />
        <ReviewRow label="Paket" value={PLANS[result.plan].label} />
      </dl>

      {result.temporaryPassword ? (
        <div className="mx-6 mb-6 rounded-lg border border-warning/30 bg-warning-soft p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <KeyRound aria-hidden="true" className="size-4" /> Geçici parola — yalnızca şimdi gösteriliyor
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 select-all rounded-md border border-border bg-bg px-3 py-2.5 font-mono text-base tracking-wide text-fg">{result.temporaryPassword}</code>
            <Button variant="secondary" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
          </div>
          <p className="mt-3 text-[0.8125rem] text-warning">
            Bu parola saklanmaz (yalnızca güvenli özeti tutulur) ve daha sonra görüntülenemez. Şimdi kopyalayıp işletme sahibine güvenli bir kanaldan iletin.
          </p>
          <span className="sr-only" aria-live="polite">
            {copied ? "Parola panoya kopyalandı." : ""}
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border bg-surface px-6 py-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onRestart}>
          Yeni İşletme Oluştur
        </Button>
        <Link href="/admin/isletmeler" className={buttonVariants({ variant: "secondary" })}>
          İşletmeler Listesi
        </Link>
        <Link href={`/admin/isletmeler/${result.tenantId}`} className={buttonVariants()}>
          İşletmeye Git
        </Link>
      </div>
    </section>
  );
}
