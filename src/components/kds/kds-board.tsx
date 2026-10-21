"use client";

import { BellOff, BellRing, ChefHat, Maximize, Minimize, Settings2, Sun, SunDim } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { formatElapsed, urgencyFor, type Urgency } from "@/lib/orders/routing";
import { formatOrderNumber } from "@/lib/orders/status";
import type { RealtimeEnvelope } from "@/lib/realtime/events";
import { cn } from "@/lib/utils/cn";
import { ticketStatusAction } from "@/server/actions/order.actions";
import { useRealtimeStream } from "@/hooks/use-realtime-stream";
import { ConnectionIndicator, PANEL_EVENTS_URL } from "@/components/realtime/live-refresh";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export type KdsStation = { id: string; name: string; branchName: string; active: boolean };
export type KdsTicket = {
  id: string;
  stationId: string;
  stationName: string;
  status: "PENDING" | "PREPARING" | "READY";
  createdAt: number;
  startedAt: number | null;
  readyAt: number | null;
  orderNumber: number;
  tableName: string;
  areaName: string | null;
  branchName: string;
  customerNote: string | null;
  items: { id: string; quantity: number; name: string; variant: string | null; note: string | null; modifiers: string[] }[];
};

const ALL = "all";
const STORAGE_KEY = "mn.kds.station";
const STORAGE_EVENT = "mn-kds-station";

// ─── Seçili istasyon (bu cihazda hatırlanır) ────────────────────────────────

function subscribeStation(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}
function readStation(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ALL;
  } catch {
    return ALL;
  }
}
function writeStation(value: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* gizli mod: yalnızca bu oturum */
  }
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

// ─── Sesli uyarı (kullanıcı açınca; tarayıcı otomatik çalmaya izin vermez) ──

function beep(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (const [offset, freq] of [
    [0, 880],
    [0.18, 1175],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, t + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.18);
  }
}

const LANES = [
  { status: "PENDING", title: "Yeni", empty: "Yeni fiş yok." },
  { status: "PREPARING", title: "Hazırlanıyor", empty: "Hazırlanan fiş yok." },
  { status: "READY", title: "Hazır", empty: "Servis bekleyen fiş yok." },
] as const;

const URGENCY_STYLES: Record<Urgency, string> = {
  normal: "ring-border",
  warning: "ring-2 ring-warning",
  critical: "ring-[3px] ring-danger",
};

export function KdsBoard({ stations, tickets, serverNow, canAct, canManageStations }: { stations: KdsStation[]; tickets: KdsTicket[]; serverNow: number; canAct: boolean; canManageStations: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const stored = useSyncExternalStore(subscribeStation, readStation, () => ALL);
  const selected = stored === ALL || stations.some((s) => s.id === stored) ? stored : ALL;
  const [now, setNow] = useState(serverNow);
  const [soundOn, setSoundOn] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const boardRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const knownRef = useRef<Set<string> | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const multiBranch = new Set(stations.map((s) => s.branchName)).size > 1;
  const visible = useMemo(() => (selected === ALL ? tickets : tickets.filter((t) => t.stationId === selected)), [tickets, selected]);

  // Saat: süreler saniyede bir ilerler.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Canlı akış: olay / yeniden bağlanma → sunucudan yeniden çek (art arda olaylar tek yenilemede).
  const streamState = useRealtimeStream(PANEL_EVENTS_URL, {
    onEvent: (event: RealtimeEnvelope) => {
      // KDS yalnızca hazırlık: ön salon servis talepleri buraya karışmaz.
      if (event.type.startsWith("SERVICE_REQUEST_")) return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 200);
    },
    onReconnect: () => router.refresh(),
  });
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  // Yeni fiş sesi: yalnızca seçili istasyonda, ilk yüklemede değil.
  useEffect(() => {
    const pendingIds = visible.filter((t) => t.status === "PENDING").map((t) => t.id);
    const known = knownRef.current;
    if (known && soundOn && audioRef.current && pendingIds.some((id) => !known.has(id))) beep(audioRef.current);
    knownRef.current = new Set([...(known ?? []), ...pendingIds]);
  }, [visible, soundOn]);

  // Tam ekran durumu (Esc ile çıkış dahil).
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Ekranı açık tut: sekme görünür olunca yeniden al; kapanınca bırak.
  useEffect(() => {
    if (!wakeOn || !("wakeLock" in navigator)) return;
    let cancelled = false;
    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) await sentinel.release();
        else wakeRef.current = sentinel;
      } catch {
        /* pil tasarrufu vb. — sessizce yok say */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void wakeRef.current?.release().catch(() => {});
      wakeRef.current = null;
    };
  }, [wakeOn]);

  useEffect(() => () => void audioRef.current?.close().catch(() => {}), []);

  function toggleSound() {
    if (!soundOn) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return toast("Bu tarayıcı sesli bildirimi desteklemiyor.", "error");
      audioRef.current ??= new Ctor();
      void audioRef.current.resume();
      beep(audioRef.current);
    }
    setSoundOn(!soundOn);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await boardRef.current?.requestFullscreen();
    } catch {
      toast("Tam ekran açılamadı.", "error");
    }
  }

  function advance(ticket: KdsTicket) {
    const to = ticket.status === "PENDING" ? "PREPARING" : "READY";
    setPendingId(ticket.id);
    startTransition(async () => {
      const result = await ticketStatusAction(ticket.id, to);
      setPendingId(null);
      if (!result.ok) toast(result.error, "error");
      router.refresh();
    });
  }

  return (
    <div ref={boardRef} className={cn("bg-bg", fullscreen && "overflow-auto p-4 sm:p-6")} data-testid="kds-board">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="kds-station" className="sr-only">
            İstasyon
          </label>
          <select
            id="kds-station"
            value={selected}
            onChange={(e) => writeStation(e.target.value)}
            className="h-12 min-w-56 rounded-md border border-border-strong bg-bg px-3 text-base font-medium focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10"
          >
            <option value={ALL}>Tüm istasyonlar</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {multiBranch ? ` · ${s.branchName}` : ""}
                {s.active ? "" : " (pasif)"}
              </option>
            ))}
          </select>
          <ConnectionIndicator state={streamState} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={soundOn ? "primary" : "secondary"} onClick={toggleSound} aria-pressed={soundOn} className="min-h-12">
            {soundOn ? <BellRing aria-hidden="true" /> : <BellOff aria-hidden="true" />} {soundOn ? "Ses açık" : "Ses Bildirimlerini Aç"}
          </Button>
          <Button variant="secondary" onClick={() => setWakeOn(!wakeOn)} aria-pressed={wakeOn} className="min-h-12" title="Ekranın kendiliğinden kapanmasını engeller (destekleyen tarayıcılarda)">
            {wakeOn ? <Sun aria-hidden="true" /> : <SunDim aria-hidden="true" />} {wakeOn ? "Ekran açık kalacak" : "Ekranı Açık Tut"}
          </Button>
          <Button variant="secondary" onClick={toggleFullscreen} className="min-h-12">
            {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />} {fullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
          </Button>
          {canManageStations && !fullscreen ? (
            <Link href="/panel/mutfak/istasyonlar" className={cn(buttonVariants({ variant: "ghost" }), "min-h-12")}>
              <Settings2 aria-hidden="true" /> İstasyonlar
            </Link>
          ) : null}
        </div>
      </div>

      {!stations.length ? (
        <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
          <ChefHat aria-hidden="true" className="mx-auto size-8 text-fg-subtle" />
          <p className="mt-3 font-medium">Henüz hazırlama istasyonu yok</p>
          <p className="mt-1 text-sm text-fg-subtle">Kabul edilen siparişlerin mutfağa düşmesi için en az bir varsayılan istasyon tanımlayın.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {LANES.map((lane) => {
            const list = visible.filter((t) => t.status === lane.status);
            return (
              <section key={lane.status} aria-labelledby={`lane-${lane.status}`} className="min-w-0 rounded-xl bg-surface-2/60 p-3" data-testid={`kds-lane-${lane.status}`}>
                <h2 id={`lane-${lane.status}`} className="flex items-center justify-between px-1 pb-3 text-lg font-semibold">
                  {lane.title}
                  <span className="rounded-full bg-bg px-2.5 py-0.5 text-sm tabular-nums ring-1 ring-border">{list.length}</span>
                </h2>
                {list.length ? (
                  <ol className="grid gap-3">
                    {list.map((ticket) => (
                      <TicketCard key={ticket.id} ticket={ticket} now={now} showStation={selected === ALL} canAct={canAct} busy={pendingId === ticket.id} onAdvance={() => advance(ticket)} />
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-subtle">{lane.empty}</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TicketCard({ ticket, now, showStation, canAct, busy, onAdvance }: { ticket: KdsTicket; now: number; showStation: boolean; canAct: boolean; busy: boolean; onAdvance: () => void }) {
  const ready = ticket.status === "READY";
  const elapsed = (ready && ticket.readyAt ? ticket.readyAt : now) - ticket.createdAt;
  const urgency = ready ? "normal" : urgencyFor(elapsed);
  const label = `${formatOrderNumber(ticket.orderNumber)}, ${ticket.tableName}`;
  return (
    <li className={cn("rounded-xl bg-bg p-4 shadow-sm ring-1", URGENCY_STYLES[urgency])} data-testid="kds-ticket" data-ticket-status={ticket.status} data-urgency={urgency} data-order-number={ticket.orderNumber}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums leading-none">{formatOrderNumber(ticket.orderNumber)}</p>
          <p className="mt-1.5 text-lg font-semibold">
            {ticket.tableName}
            {ticket.areaName ? <span className="font-normal text-fg-muted"> · {ticket.areaName}</span> : null}
          </p>
          {showStation ? <p className="mt-0.5 text-sm text-fg-subtle">{ticket.stationName}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("text-xl font-semibold tabular-nums", urgency === "critical" ? "text-danger" : urgency === "warning" ? "text-warning" : "text-fg-muted")} aria-label={ready ? "Hazırlanma süresi" : "Geçen süre"}>
            {formatElapsed(elapsed)}
          </p>
          {urgency !== "normal" ? <p className={cn("text-xs font-semibold uppercase", urgency === "critical" ? "text-danger" : "text-warning")}>{urgency === "critical" ? "Gecikti" : "Bekliyor"}</p> : null}
        </div>
      </div>

      <ul className="mt-3 grid gap-2 border-t border-border pt-3">
        {ticket.items.map((item) => (
          <li key={item.id} data-testid="kds-item">
            <p className="text-lg leading-snug">
              <span className="font-bold tabular-nums">{item.quantity}×</span> <span className="font-semibold">{item.name}</span>
              {item.variant ? <span className="text-fg-muted"> — {item.variant}</span> : null}
            </p>
            {item.modifiers.length ? (
              <ul className="ms-6 text-base text-fg-muted">
                {item.modifiers.map((m, i) => (
                  <li key={i}>+ {m}</li>
                ))}
              </ul>
            ) : null}
            {item.note ? <p className="ms-6 mt-1 rounded-md bg-warning-soft px-2 py-1 text-base font-medium text-warning">Not: {item.note}</p> : null}
          </li>
        ))}
      </ul>
      {ticket.customerNote ? <p className="mt-3 rounded-md bg-info-soft px-2.5 py-1.5 text-base text-info">Sipariş notu: {ticket.customerNote}</p> : null}

      {canAct && !ready ? (
        <Button className="mt-4 min-h-12 w-full text-base" variant={ticket.status === "PENDING" ? "secondary" : "primary"} onClick={onAdvance} disabled={busy} aria-label={`${label}: ${ticket.status === "PENDING" ? "hazırlamaya başla" : "hazır"}`}>
          {busy ? "İşleniyor…" : ticket.status === "PENDING" ? "Hazırlamaya Başla" : "Hazır"}
        </Button>
      ) : null}
      {ready ? <p className="mt-3 text-sm font-medium text-success">Servis bekliyor</p> : null}
    </li>
  );
}
