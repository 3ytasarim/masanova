"use client";

import { CalendarCheck2, Check, Clock, Copy, Minus, Phone, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { reservationStrings } from "@/lib/reservations/i18n";
import { addDays, weekdayOf } from "@/lib/reservations/time";
import { cn } from "@/lib/utils/cn";
import { createPublicReservationAction, reservationAvailabilityAction, type BookResult } from "@/server/actions/reservation-public.actions";
import type { SlotView } from "@/server/reservations/availability.service";

export type BookingBranch = {
  slug: string;
  name: string;
  phone: string | null;
  today: string;
  lastDate: string;
  areas: { id: string; name: string }[];
  maxOnline: number;
  openWeekdays: number[];
};

type Times = { state: "idle" } | { state: "loading" } | { state: "ok"; slots: SlotView[] } | { state: "message"; text: string };

const CHIP_DAYS = 14;
const inputCls = "mt-1.5 block min-h-12 w-full rounded-xl border-0 bg-white px-3.5 text-[1rem] text-stone-900 shadow-sm ring-1 ring-stone-300 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900";

function randomKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mobil öncelikli rezervasyon akışı: şube → tarih → kişi → saat → bölge tercihi → iletişim → özet → onay.
 * Saatler sunucudan (yalnızca gerçekten masası olanlar). Tekrar gönderim aynı idempotency anahtarını kullanır
 * (çift rezervasyon olmaz); içerik değişirse yeni anahtar üretilir.
 */
export function ReservationBooking({ locale, branches, minParty }: { locale: string; branches: BookingBranch[]; minParty: number }) {
  const s = reservationStrings(locale);
  const ids = { branch: useId(), date: useId(), area: useId(), name: useId(), phone: useId(), email: useId(), request: useId() };
  const [branchSlug, setBranchSlug] = useState(branches[0]!.slug);
  const branch = branches.find((b) => b.slug === branchSlug)!;
  const [date, setDate] = useState<string | null>(null);
  const [party, setParty] = useState(Math.max(2, minParty));
  const [times, setTimes] = useState<Times>({ state: "idle" });
  const [time, setTime] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", request: "", website: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<BookResult, { kind: "created" }> | null>(null);
  const [alternatives, setAlternatives] = useState<SlotView[] | null>(null);
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);
  const idem = useRef<{ key: string; sig: string } | null>(null);
  const tooLarge = party > branch.maxOnline;

  const dateLabel = (d: string, long = false) =>
    new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { timeZone: "UTC", weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short" }).format(new Date(`${d}T12:00:00Z`));
  const chipPart = (d: string, part: "weekday" | "dayMonth") =>
    new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", part === "weekday" ? { timeZone: "UTC", weekday: "short" } : { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));

  async function load(nextBranch: string, nextDate: string | null, nextParty: number) {
    setTime(null);
    if (!nextDate) return setTimes({ state: "idle" });
    const b = branches.find((x) => x.slug === nextBranch)!;
    if (nextParty > b.maxOnline) return setTimes({ state: "idle" });
    const mine = ++seq.current;
    setTimes({ state: "loading" });
    const r = await reservationAvailabilityAction({ branch: nextBranch, date: nextDate, party: nextParty }).catch(() => null);
    if (mine !== seq.current) return;
    if (!r) return setTimes({ state: "message", text: s.invalid });
    if (r.kind === "ok") return setTimes({ state: "ok", slots: r.slots });
    const text = r.kind === "closed_day" ? s.closedDay : r.kind === "out_of_range" ? s.outOfRange : r.kind === "party_too_large" ? s.largeGroup : r.kind === "rate_limited" ? s.rateLimited : r.kind === "disabled" ? s.disabled : s.invalid;
    setTimes({ state: "message", text });
  }

  const chooseDate = (d: string) => {
    setDate(d);
    setAlternatives(null);
    setError(null);
    void load(branchSlug, d, party);
  };
  const changeParty = (n: number) => {
    const next = Math.max(minParty, Math.min(99, n));
    setParty(next);
    setAlternatives(null);
    setError(null);
    void load(branchSlug, date, next);
  };
  const chooseBranch = (slug: string) => {
    setBranchSlug(slug);
    setAlternatives(null);
    setError(null);
    setArea("");
    void load(slug, date, party);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending || !date || !time) return;
    const payload = { branch: branchSlug, date, time, party, area: area || null, name: form.name, phone: form.phone, email: form.email || null, request: form.request || null, website: form.website || null, locale };
    const sig = JSON.stringify(payload);
    if (!idem.current || idem.current.sig !== sig) idem.current = { key: randomKey(), sig };
    setSending(true);
    setError(null);
    try {
      const r = await createPublicReservationAction({ ...payload, idempotencyKey: idem.current.key });
      if (r.kind === "created") setResult(r);
      else if (r.kind === "taken") {
        setAlternatives(r.alternatives);
        setTime(null);
        setError(s.taken);
        void load(branchSlug, date, party);
      } else if (r.kind === "party_too_large") setError(s.largeGroup);
      else setError(r.reason === "rate_limited" ? s.rateLimited : r.reason === "too_soon" ? s.tooSoon : r.reason === "closed" ? s.closed : r.reason === "disabled" ? s.disabled : r.reason === "conflict" ? s.conflict : s.invalid);
    } catch {
      setError(s.invalid);
    } finally {
      setSending(false);
    }
  }

  if (result) {
    const when = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "full", timeStyle: "short" }).format(new Date(result.startsAt));
    const absolute = typeof window !== "undefined" ? `${window.location.origin}${result.manageUrl}` : result.manageUrl;
    return (
      <section className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-stone-200" data-testid="res-result" data-status={result.status} aria-live="polite">
        <span aria-hidden="true" className="inline-flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <CalendarCheck2 className="size-5" />
        </span>
        <h2 className="mt-4 text-[1.375rem] font-semibold tracking-tight">{result.status === "CONFIRMED" ? s.confirmed : s.pending}</h2>
        {result.status === "PENDING" ? <p className="mt-1 text-stone-600">{s.pendingBody}</p> : null}
        <dl className="mt-4 grid gap-2 text-[0.9375rem]">
          <div className="flex gap-2">
            <dt className="text-stone-500">{s.when}:</dt>
            <dd className="font-medium">{when}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-stone-500">{s.guests}:</dt>
            <dd className="font-medium">{s.partyValue(result.partySize)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-stone-500">{s.place}:</dt>
            <dd className="font-medium">{result.branchName}</dd>
          </div>
        </dl>
        <p className="mt-5 text-sm text-stone-600">{s.manageHint}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={result.manageUrl} className="inline-flex min-h-12 items-center rounded-xl bg-stone-900 px-4 font-semibold text-white" data-testid="manage-link">
            {s.manageLink}
          </Link>
          <button
            type="button"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl px-4 font-medium text-stone-800 ring-1 ring-stone-300"
            onClick={() => {
              void navigator.clipboard?.writeText(absolute).then(() => setCopied(true), () => setCopied(false));
            }}
          >
            {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />} {copied ? s.copied : s.copy}
          </button>
        </div>
      </section>
    );
  }

  const chips = Array.from({ length: CHIP_DAYS }, (_, i) => addDays(branch.today, i)).filter((d) => d <= branch.lastDate);
  const ready = !!(date && time && !tooLarge);

  return (
    <form onSubmit={submit} className="mt-8 grid gap-8" noValidate data-testid="reservation-form">
      {branches.length > 1 ? (
        <div>
          <label htmlFor={ids.branch} className="text-sm font-semibold text-stone-700">
            {s.branch}
          </label>
          <select id={ids.branch} value={branchSlug} onChange={(e) => chooseBranch(e.target.value)} className={inputCls} data-testid="res-branch">
            {branches.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <fieldset>
        <legend className="text-sm font-semibold text-stone-700">{s.date}</legend>
        <div className="-mx-4 mt-2 flex snap-x gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label={s.date}>
          {chips.map((d) => {
            const closed = !branch.openWeekdays.includes(weekdayOf(d));
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={date === d}
                disabled={closed}
                data-date={d}
                onClick={() => chooseDate(d)}
                className={cn(
                  "flex min-h-14 min-w-[4.5rem] shrink-0 snap-start flex-col items-center justify-center rounded-xl px-3 text-sm ring-1 transition-colors",
                  date === d ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-800 ring-stone-200 hover:ring-stone-400",
                  closed && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="capitalize">{chipPart(d, "weekday")}</span>
                <span className="font-semibold">{chipPart(d, "dayMonth")}</span>
              </button>
            );
          })}
        </div>
        <label htmlFor={ids.date} className="mt-3 block text-sm text-stone-600">
          {s.otherDate}
        </label>
        <input id={ids.date} type="date" min={branch.today} max={branch.lastDate} value={date ?? ""} onChange={(e) => e.target.value && chooseDate(e.target.value)} className={cn(inputCls, "max-w-[14rem]")} />
      </fieldset>

      <div>
        <p className="text-sm font-semibold text-stone-700" id="party-label">
          {s.party}
        </p>
        <div className="mt-2 inline-flex items-center gap-3 rounded-2xl bg-white p-1.5 ring-1 ring-stone-200" role="group" aria-labelledby="party-label">
          <button type="button" aria-label={s.decrease} onClick={() => changeParty(party - 1)} disabled={party <= minParty} className="inline-flex size-12 items-center justify-center rounded-xl text-stone-800 hover:bg-stone-100 disabled:opacity-40" data-testid="party-dec">
            <Minus aria-hidden="true" className="size-5" />
          </button>
          <span className="inline-flex min-w-[5.5rem] items-center justify-center gap-1.5 font-semibold tabular-nums" aria-live="polite" data-testid="party-value" data-party={party}>
            <Users aria-hidden="true" className="size-4 text-stone-500" /> {s.partyValue(party)}
          </span>
          <button type="button" aria-label={s.increase} onClick={() => changeParty(party + 1)} className="inline-flex size-12 items-center justify-center rounded-xl text-stone-800 hover:bg-stone-100" data-testid="party-inc">
            <Plus aria-hidden="true" className="size-5" />
          </button>
        </div>
        {tooLarge ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200" data-testid="large-group">
            {s.largeGroup}{" "}
            {branch.phone ? (
              <a href={`tel:${branch.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 font-semibold underline">
                <Phone aria-hidden="true" className="size-3.5" /> {branch.phone}
              </a>
            ) : null}
          </p>
        ) : null}
      </div>

      {date && !tooLarge ? (
        <fieldset>
          <legend className="flex items-center gap-2 text-sm font-semibold text-stone-700">
            <Clock aria-hidden="true" className="size-4" /> {s.times} · <span className="font-normal capitalize text-stone-500">{dateLabel(date, true)}</span>
          </legend>
          {times.state === "loading" ? <p className="mt-3 text-sm text-stone-500">{s.loadingTimes}</p> : null}
          {times.state === "message" ? <p className="mt-3 text-sm text-stone-600" data-testid="times-message">{times.text}</p> : null}
          {times.state === "ok" && times.slots.length === 0 ? <p className="mt-3 text-sm text-stone-600" data-testid="times-message">{s.noTimes}</p> : null}
          {times.state === "ok" && times.slots.length ? (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={s.times}>
              {times.slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  role="radio"
                  aria-checked={time === slot.label}
                  data-testid="slot"
                  data-time={slot.label}
                  onClick={() => {
                    setTime(slot.label);
                    setAlternatives(null);
                    setError(null);
                  }}
                  className={cn("min-h-12 rounded-xl text-[0.9375rem] font-semibold tabular-nums ring-1 transition-colors", time === slot.label ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-800 ring-stone-200 hover:ring-stone-400")}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {time ? (
        <>
          {branch.areas.length > 1 ? (
            <div>
              <label htmlFor={ids.area} className="text-sm font-semibold text-stone-700">
                {s.area}
              </label>
              <select id={ids.area} value={area} onChange={(e) => setArea(e.target.value)} className={inputCls} data-testid="res-area">
                <option value="">{s.areaAny}</option>
                {branch.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-stone-500">{s.areaHint}</p>
            </div>
          ) : null}

          <fieldset className="grid gap-4">
            <legend className="mb-1 text-sm font-semibold text-stone-700">{s.contact}</legend>
            <div>
              <label htmlFor={ids.name} className="text-sm font-medium text-stone-700">
                {s.name}
              </label>
              <input id={ids.name} name="name" autoComplete="name" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label htmlFor={ids.phone} className="text-sm font-medium text-stone-700">
                {s.phone}
              </label>
              <input id={ids.phone} name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={32} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} aria-describedby={`${ids.phone}-hint`} />
              <p id={`${ids.phone}-hint`} className="mt-1 text-xs text-stone-500">
                {s.phoneHint}
              </p>
            </div>
            <div>
              <label htmlFor={ids.email} className="text-sm font-medium text-stone-700">
                {s.email}
              </label>
              <input id={ids.email} name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label htmlFor={ids.request} className="text-sm font-medium text-stone-700">
                {s.request}
              </label>
              <textarea id={ids.request} name="request" rows={2} maxLength={300} value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })} className={cn(inputCls, "min-h-20 py-3")} aria-describedby={`${ids.request}-hint`} />
              <p id={`${ids.request}-hint`} className="mt-1 text-xs text-stone-500">
                {s.requestHint}
              </p>
            </div>
            {/* Bal tuzağı: ekran okuyucu ve klavyeden gizli */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </label>
            </div>
          </fieldset>

          <section aria-label={s.review} className="rounded-2xl bg-white p-5 ring-1 ring-stone-200" data-testid="res-review">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-stone-500">{s.review}</p>
            <p className="mt-2 font-semibold capitalize">
              {dateLabel(date!, true)} · {time}
            </p>
            <p className="text-stone-600">
              {s.partyValue(party)} · {branch.name}
              {area ? ` · ${branch.areas.find((a) => a.id === area)?.name ?? ""}` : ""}
            </p>
          </section>
        </>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200" data-testid={alternatives ? "res-taken" : "res-error"}>
          <p className="font-medium">{error}</p>
          {alternatives?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {alternatives.map((a) => (
                <button key={a.startsAt} type="button" data-testid="alt-slot" onClick={() => {
                  setTime(a.label);
                  setError(null);
                  setAlternatives(null);
                }} className="min-h-11 rounded-lg bg-white px-3 font-semibold tabular-nums ring-1 ring-amber-300">
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {time ? (
        <button type="submit" disabled={!ready || sending} className="min-h-12 w-full rounded-xl bg-stone-900 px-4 text-[1rem] font-semibold text-white disabled:opacity-50" data-testid="res-submit">
          {sending ? s.sending : s.confirm}
        </button>
      ) : null}
    </form>
  );
}
