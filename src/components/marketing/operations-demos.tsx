"use client";

import { ArrowRight, BellRing, ChefHat, CircleCheck, Droplets, HandPlatter, Receipt, Timer, type LucideIcon } from "lucide-react";
import { KDS, SERVICE } from "@/content/marketing/copy";
import { cn } from "@/lib/utils/cn";
import { useDemoLoop } from "@/components/marketing/use-demo-loop";

/**
 * Mutfak (KDS) ve servis canlandırmaları — sade: fiş sütunlar arasında ilerler; servis talebi "Personel ilgileniyor"a
 * döner. Yalnızca görünürken çalışır; hareket azaltmada son durum sabit.
 */
const KDS_DURATIONS = [1600, 1500, 1800, 2400] as const;
/** Sütunlarda sabit duran diğer fişler (pano boş görünmesin; hareket eden yalnızca #1042). */
const STATIC_TICKETS = [
  { number: "#1043", table: "Masa 4", item: "Limonata", station: "Bar", time: "0:40" },
  { number: "#1041", table: "Masa 7", item: "Sütlaç", station: "Tatlı", time: "4:15" },
  null,
] as const;

export function KdsDemo() {
  const { ref, step, paused } = useDemoLoop<HTMLDivElement>(KDS_DURATIONS);
  // 0: istasyonlara ayrılıyor, 1: Yeni, 2: Hazırlanıyor, 3: Hazır
  const column = step <= 1 ? 0 : step === 2 ? 1 : 2;
  return (
    <div ref={ref} aria-hidden="true" data-testid="kds-demo" data-column={column} data-paused={paused ? "" : undefined} className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {KDS.routes.map((r, i) => (
          <div key={r.item} className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm transition-all duration-500", step >= 0 ? "border-white/10 bg-white/[0.04]" : "")} style={{ transitionDelay: `${i * 120}ms` }}>
            <span className="font-medium">{r.item}</span>
            <ArrowRight className="size-3.5 text-fg-subtle" />
            <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-300">{r.station}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {KDS.columns.map((c, ci) => (
          <div key={c} className="min-h-[220px] rounded-2xl sm:min-h-[300px] border border-white/10 bg-white/[0.03] p-2 sm:p-3">
            <p className="flex items-center justify-between px-1 text-xs font-semibold text-fg-subtle">
              {c}
              <span className="tabular-nums">{(column === ci ? 1 : 0) + (STATIC_TICKETS[ci] ? 1 : 0)}</span>
            </p>
            {STATIC_TICKETS[ci] ? (
              <div className="mt-2 rounded-xl bg-white/90 p-2.5 text-stone-900 sm:p-3">
                <p className="text-[0.8rem] font-semibold">{STATIC_TICKETS[ci]!.number}</p>
                <p className="text-[0.7rem] text-stone-500">{STATIC_TICKETS[ci]!.table}</p>
                <p className="mt-2 text-[0.7rem]">
                  {STATIC_TICKETS[ci]!.item} <span className="text-stone-400">· {STATIC_TICKETS[ci]!.station}</span>
                </p>
                <span className={cn("mt-2 inline-flex rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold", ci === 0 ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800")}>{STATIC_TICKETS[ci]!.time}</span>
              </div>
            ) : null}
            <div className={cn("mt-2 transition-all duration-700", column === ci ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0")}>
              <div className="rounded-xl bg-white p-2.5 text-stone-900 shadow-lg sm:p-3">
                <p className="text-[0.8rem] font-semibold">{KDS.ticket.number}</p>
                <p className="text-[0.7rem] text-stone-500">{KDS.ticket.table}</p>
                <ul className="mt-2 grid gap-0.5 text-[0.7rem]">
                  <li className="flex items-center gap-1">
                    <ChefHat className="size-3 shrink-0 text-stone-400" /> Burger
                  </li>
                </ul>
                <span
                  className={cn(
                    "mt-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.62rem] font-semibold",
                    ci === 0 ? "bg-sky-100 text-sky-800" : ci === 1 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
                  )}
                >
                  {ci === 2 ? <CircleCheck className="size-3" /> : <Timer className="size-3" />}
                  {ci === 0 ? "0:12" : ci === 1 ? "6:40" : "11:05"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const REQUEST_ICONS: LucideIcon[] = [HandPlatter, Droplets, BellRing, Receipt];
const SERVICE_DURATIONS = [1400, 1500, 2600] as const;

export function ServiceDemo() {
  const { ref, step, paused } = useDemoLoop<HTMLDivElement>(SERVICE_DURATIONS);
  // 0: istek bekleniyor, 1: "Garson Çağır" gönderildi, 2: personel ilgileniyor
  return (
    <div ref={ref} aria-hidden="true" data-testid="service-demo" data-step={step} data-paused={paused ? "" : undefined} className="grid gap-4">
      <div className="grid grid-cols-2 gap-2.5">
        {SERVICE.requests.map((r, i) => {
          const Icon = REQUEST_ICONS[i] ?? BellRing;
          const active = i === 0 && step >= 1;
          return (
            <span
              key={r}
              className={cn(
                "flex min-h-14 items-center gap-2.5 rounded-2xl border px-3.5 text-sm font-semibold transition-all duration-500",
                active ? "border-[#c2410c] bg-[#c2410c] text-white shadow-lg" : "border-border bg-bg text-fg",
              )}
            >
              <Icon className="size-4.5 shrink-0" />
              {r}
            </span>
          );
        })}
      </div>
      <div className={cn("flex items-center gap-3 rounded-2xl border border-border bg-bg p-4 transition-all duration-700", step >= 1 ? "opacity-100" : "opacity-40")}>
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-500", step === 2 ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {step === 2 ? <CircleCheck className="size-5" /> : <BellRing className="size-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Masa 12 · Garson çağrısı</p>
          <p className="text-sm text-fg-muted">{step === 2 ? `${SERVICE.status} · 42 sn` : step === 1 ? "Servis panosuna düştü" : "Talep bekleniyor"}</p>
        </div>
      </div>
    </div>
  );
}
