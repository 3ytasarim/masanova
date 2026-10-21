"use client";

import { BadgeCheck, Gift, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { customerStrings } from "@/lib/crm/i18n";
import { logoutCustomerAction, requestCustomerDeletionAction, updateCustomerConsentsAction, updateCustomerNameAction, type ProfileResult } from "@/server/actions/customer.actions";
import { ConsentBox } from "@/components/public/crm/join-form";

/**
 * Müşterinin kendi hesabı: ad güncelleme, izin yönetimi (geri alma ANINDA), puan bakiyesi, bu cihazda çıkış ve veri
 * silme talebi. İletişim bilgisi maskeli gösterilir (paylaşılan cihaz); doğrulama sağlayıcısı olmadığı için iletişim
 * değişikliği müşteriye açık değil (personel üzerinden).
 */
type ConsentFlags = { LOYALTY: boolean; MARKETING_EMAIL: boolean; MARKETING_SMS: boolean; MARKETING_WHATSAPP: boolean };
type Props = {
  token: string;
  locale: string;
  profile: { firstName: string | null; lastName: string | null; phone: string | null; email: string | null; phoneVerified: boolean; emailVerified: boolean; consents: ConsentFlags };
  loyalty: { active: boolean; ruleText: string | null; points: number | null };
};

export function ProfilePanel({ token, locale, profile, loyalty }: Props) {
  const c = customerStrings(locale);
  const router = useRouter();
  const ids = { first: useId(), last: useId() };
  const [firstName, setFirstName] = useState(profile.firstName ?? "");
  const [lastName, setLastName] = useState(profile.lastName ?? "");
  const [consents, setConsents] = useState<ConsentFlags>(profile.consents);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const errorText = (r: Extract<ProfileResult, { ok: false }>) => (r.reason === "rate_limited" ? c.rateLimited : r.reason === "context_invalid" ? c.contextInvalid : r.reason === "no_identity" ? c.noIdentity : c.invalid);

  async function run(fn: () => Promise<ProfileResult>, okText: string): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setStatus(null);
    try {
      const r = await fn();
      if (r.ok) {
        setStatus({ tone: "ok", text: okText });
        router.refresh();
        return true;
      }
      setStatus({ tone: "error", text: errorText(r) });
      return false;
    } catch {
      setStatus({ tone: "error", text: c.unavailable });
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const setConsent = (type: keyof ConsentFlags, value: boolean) => {
    const previous = consents;
    setConsents({ ...consents, [type]: value });
    void run(() => updateCustomerConsentsAction(token, { [type]: value }), c.saved).then((ok) => {
      if (!ok) setConsents(previous);
    });
  };

  const marketing: { type: keyof ConsentFlags; enabled: boolean }[] = [
    { type: "MARKETING_SMS", enabled: !!profile.phone },
    { type: "MARKETING_WHATSAPP", enabled: !!profile.phone },
    { type: "MARKETING_EMAIL", enabled: !!profile.email },
  ];
  const verifiedAny = profile.phoneVerified || profile.emailVerified;

  return (
    <div className="mt-1" data-testid="customer-profile">
      <h1 className="text-[1.75rem] font-semibold tracking-tight">{c.profileTitle}</h1>
      <p className="mt-2 text-stone-600">{c.profileIntro}</p>

      {loyalty.active ? (
        <section aria-labelledby="loyalty-h" className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-stone-200">
          <h2 id="loyalty-h" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-stone-500">
            <Gift aria-hidden="true" className="size-4" /> {c.loyaltyHeading}
          </h2>
          {consents.LOYALTY && loyalty.points !== null ? (
            <p className="mt-2 text-[2rem] font-semibold tabular-nums" data-testid="loyalty-balance" data-points={loyalty.points}>
              {c.pointsShort(loyalty.points)}
            </p>
          ) : null}
          {loyalty.ruleText ? <p className="mt-1 text-sm text-stone-600">{loyalty.ruleText}</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="contact-h" className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-stone-200">
        <h2 id="contact-h" className="text-sm font-semibold uppercase tracking-[0.08em] text-stone-500">
          {c.contactHeading}
        </h2>
        <ul className="mt-2 grid gap-1.5 text-[0.9375rem]">
          {profile.phone ? (
            <li className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">{profile.phone}</span>
              {profile.phoneVerified ? <Verified label={c.verifiedBadge} /> : null}
            </li>
          ) : null}
          {profile.email ? (
            <li className="flex flex-wrap items-center gap-2 break-all">
              <span>{profile.email}</span>
              {profile.emailVerified ? <Verified label={c.verifiedBadge} /> : null}
            </li>
          ) : null}
        </ul>
        {!verifiedAny ? <p className="mt-2 text-sm text-stone-500">{c.unverifiedNote}</p> : null}
        <p className="mt-1 text-sm text-stone-500">{c.contactChangeHint}</p>
      </section>

      <form
        className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-stone-200"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateCustomerNameAction(token, { firstName, lastName }), c.saved);
        }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-stone-500">{c.name}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.first} className="block text-sm font-medium text-stone-700">
              {c.firstName}
            </label>
            <input id={ids.first} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className="mt-1.5 block min-h-12 w-full rounded-xl border-0 bg-white px-3.5 shadow-sm ring-1 ring-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900" />
          </div>
          <div>
            <label htmlFor={ids.last} className="block text-sm font-medium text-stone-700">
              {c.lastName}
            </label>
            <input id={ids.last} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" className="mt-1.5 block min-h-12 w-full rounded-xl border-0 bg-white px-3.5 shadow-sm ring-1 ring-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-900" />
          </div>
        </div>
        <button type="submit" disabled={pending} className="mt-4 min-h-12 rounded-xl bg-stone-900 px-5 font-semibold text-white disabled:opacity-50" data-testid="save-name">
          {c.save}
        </button>
      </form>

      <section aria-labelledby="consents-h" className="mt-6">
        <h2 id="consents-h" className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-stone-500">
          {c.consentsHeading}
        </h2>
        <div className="grid gap-2">
          {loyalty.active || consents.LOYALTY ? (
            <ConsentBox name="LOYALTY" label={c.consent.LOYALTY.label} description={c.consent.LOYALTY.description} checked={consents.LOYALTY} disabled={pending} onChange={(v) => setConsent("LOYALTY", v)} />
          ) : null}
          {marketing.map((m) => (
            <ConsentBox
              key={m.type}
              name={m.type}
              label={c.consent[m.type].label}
              description={m.enabled ? c.consent[m.type].description : c.marketingNeedsContact}
              checked={consents[m.type]}
              disabled={pending || (!m.enabled && !consents[m.type])}
              onChange={(v) => setConsent(m.type, v)}
            />
          ))}
        </div>
      </section>

      {status ? (
        <p role={status.tone === "error" ? "alert" : "status"} className={status.tone === "error" ? "mt-4 text-sm font-medium text-red-700" : "mt-4 text-sm font-medium text-emerald-700"} data-testid="profile-status">
          {status.text}
        </p>
      ) : null}

      <div className="mt-8 grid gap-2 border-t border-stone-200 pt-6">
        <button
          type="button"
          disabled={pending}
          onClick={() => void run(() => logoutCustomerAction(token), c.loggedOut)}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-4 font-semibold text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 disabled:opacity-50"
          data-testid="customer-logout"
        >
          <LogOut aria-hidden="true" className="size-4" /> {c.logout}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(c.deletionConfirm)) void run(() => requestCustomerDeletionAction(token), c.deletionDone);
          }}
          className="min-h-12 rounded-xl px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          data-testid="customer-deletion"
        >
          {c.deletion}
        </button>
      </div>
    </div>
  );
}

function Verified({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
      <BadgeCheck aria-hidden="true" className="size-3.5" /> {label}
    </span>
  );
}
