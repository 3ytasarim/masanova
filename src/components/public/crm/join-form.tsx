"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import type { ConsentType } from "@prisma/client";
import { customerStrings } from "@/lib/crm/i18n";
import { cn } from "@/lib/utils/cn";
import { joinCustomerAction, verifyCustomerAction, type JoinResult, type VerifyResult } from "@/server/actions/customer.actions";

/**
 * Müşteri katılım formu — isteğe bağlı. Telefon ya da e-posta → (doğrulama açıksa kod) → isteğe bağlı ad → onaylar.
 * Pazarlama kutuları VARSAYILAN KAPALI ve yalnızca ilgili iletişim girildiyse seçilebilir. Gizlilik onayı zorunlu
 * (kayıt için); sadakat onayı ayrı ve isteğe bağlı. Sunucu tüm kuralları yeniden uygular.
 */
type Props = { token: string; locale: string; from: "menu" | "order" | "loyalty"; loyalty: { active: boolean; ruleText: string | null } };

const inputCls = "mt-1.5 block min-h-12 w-full rounded-xl border-0 bg-white px-3.5 text-[1rem] text-stone-900 shadow-sm ring-1 ring-stone-300 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900";

export function JoinForm({ token, locale, from, loyalty }: Props) {
  const c = customerStrings(locale);
  const router = useRouter();
  const ids = { phone: useId(), email: useId(), first: useId(), last: useId(), code: useId() };
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [consents, setConsents] = useState<Set<ConsentType>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ id: string; channel: "PHONE" | "EMAIL" } | null>(null);
  const [code, setCode] = useState("");
  const busy = useRef(false);

  const hasPhone = phone.trim().length > 0;
  const hasEmail = email.trim().length > 0;
  const toggle = (type: ConsentType, on: boolean) =>
    setConsents((prev) => {
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });
  const effective = [...consents].filter((t) => (t === "MARKETING_EMAIL" ? hasEmail : t === "MARKETING_SMS" || t === "MARKETING_WHATSAPP" ? hasPhone : true));

  const reasonText = (r: Extract<JoinResult, { kind: "rejected" }>["reason"] | Extract<VerifyResult, { kind: "rejected" }>["reason"]) =>
    ({
      context_invalid: c.contextInvalid,
      invalid: c.invalid,
      contact_required: c.contactRequired,
      privacy_required: c.privacyRequired,
      rate_limited: c.rateLimited,
      unavailable: c.unavailable,
      invalid_code: c.codeInvalid,
      expired: c.codeExpired,
      locked: c.codeLocked,
    })[r];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    if (!hasPhone && !hasEmail) return setError(c.contactRequired);
    if (!consents.has("PRIVACY")) return setError(c.privacyRequired);
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await joinCustomerAction(token, { phone, email, firstName, lastName, consents: effective, from, language: locale });
      if (r.kind === "rejected") setError(reasonText(r.reason));
      else if (r.kind === "verify") setVerify({ id: r.verificationId, channel: r.channel });
      else router.refresh();
    } catch {
      setError(c.unavailable);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current || !verify) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await verifyCustomerAction(token, verify.id, code);
      if (r.kind === "rejected") {
        setError(reasonText(r.reason));
        if (r.reason === "expired" || r.reason === "locked") {
          setVerify(null);
          setCode("");
        }
      } else router.refresh();
    } catch {
      setError(c.unavailable);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (verify) {
    return (
      <form onSubmit={submitCode} className="mt-2" data-testid="verify-form" noValidate>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{c.verifyTitle}</h1>
        <p className="mt-2 text-stone-600">{c.verifyBody(verify.channel)}</p>
        <label htmlFor={ids.code} className="mt-6 block text-sm font-medium text-stone-700">
          {c.code}
        </label>
        <input id={ids.code} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={cn(inputCls, "tracking-[0.4em] tabular-nums")} required />
        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending || code.length !== 6} className="mt-6 min-h-12 w-full rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-50">
          {pending ? c.submitting : c.verify}
        </button>
      </form>
    );
  }

  const marketing: { type: ConsentType; enabled: boolean }[] = [
    { type: "MARKETING_SMS", enabled: hasPhone },
    { type: "MARKETING_WHATSAPP", enabled: hasPhone },
    { type: "MARKETING_EMAIL", enabled: hasEmail },
  ];

  return (
    <form onSubmit={submit} className="mt-2" data-testid="join-form" noValidate>
      <h1 className="text-[1.75rem] font-semibold tracking-tight">{c.joinTitle}</h1>
      <p className="mt-2 text-stone-600">{c.joinIntro}</p>
      {loyalty.active && loyalty.ruleText ? <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">{loyalty.ruleText}</p> : null}

      <div className="mt-6 grid gap-4">
        <div>
          <label htmlFor={ids.phone} className="block text-sm font-medium text-stone-700">
            {c.phone}
          </label>
          <input id={ids.phone} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={c.phoneHint} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor={ids.email} className="block text-sm font-medium text-stone-700">
            {c.email}
          </label>
          <input id={ids.email} name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.first} className="block text-sm font-medium text-stone-700">
              {c.firstName}
            </label>
            <input id={ids.first} name="firstName" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor={ids.last} className="block text-sm font-medium text-stone-700">
              {c.lastName}
            </label>
            <input id={ids.last} name="lastName" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      <fieldset className="mt-6 grid gap-2">
        <legend className="sr-only">{c.consentsHeading}</legend>
        <ConsentBox name="PRIVACY" label={c.consent.PRIVACY.label} description={c.consent.PRIVACY.description} checked={consents.has("PRIVACY")} onChange={(v) => toggle("PRIVACY", v)} required />
        {loyalty.active ? <ConsentBox name="LOYALTY" label={c.consent.LOYALTY.label} description={c.consent.LOYALTY.description} checked={consents.has("LOYALTY")} onChange={(v) => toggle("LOYALTY", v)} /> : null}
      </fieldset>

      <fieldset className="mt-5 grid gap-2">
        <legend className="mb-1 text-sm font-semibold text-stone-700">{c.marketingHeading}</legend>
        {marketing.map((m) => (
          <ConsentBox
            key={m.type}
            name={m.type}
            label={c.consent[m.type].label}
            description={m.enabled ? c.consent[m.type].description : c.marketingNeedsContact}
            checked={m.enabled && consents.has(m.type)}
            disabled={!m.enabled}
            onChange={(v) => toggle(m.type, v)}
          />
        ))}
      </fieldset>

      {error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="mt-6 min-h-12 w-full rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-50" data-testid="join-submit">
        {pending ? c.submitting : c.submit}
      </button>
    </form>
  );
}

export function ConsentBox({ name, label, description, checked, onChange, disabled = false, required = false }: { name: string; label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; required?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex min-h-12 cursor-pointer items-start gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-stone-200", disabled && "cursor-not-allowed opacity-60")}>
      <input id={id} type="checkbox" name={name} checked={checked} disabled={disabled} required={required} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-stone-900" data-consent={name} />
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-medium text-stone-900">
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </span>
        <span className="mt-0.5 block text-sm text-stone-500">{description}</span>
      </span>
    </label>
  );
}
