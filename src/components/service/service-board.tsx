"use client";

import { BellOff, BellRing, Maximize, Minimize } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ServiceRequestStatus, ServiceRequestType } from "@prisma/client";
import { formatElapsed, type Urgency } from "@/lib/orders/routing";
import type { RealtimeEnvelope } from "@/lib/realtime/events";
import { canHandleType, type ServiceAbilities } from "@/lib/service-requests/status";
import { formatDurationShort, serviceUrgency } from "@/lib/service-requests/timing";
import { SERVICE_TYPE_LABELS } from "@/lib/service-requests/types";
import { cn } from "@/lib/utils/cn";
import { serviceRequestStaffAction } from "@/server/actions/service-request.actions";
import { useRealtimeStream } from "@/hooks/use-realtime-stream";
import { ConnectionIndicator, PANEL_EVENTS_URL } from "@/components/realtime/live-refresh";
import { SERVICE_TYPE_ICONS } from "@/components/service/service-icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export type ServiceCard = {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  note: string | null;
  tableName: string;
  areaName: string | null;
  branchName: string;
  createdAt: number;
  acknowledgedAt: number | null;
  completedAt: number | null;
  assigneeName: string | null;
  isMine: boolean;
  orderNumber: number | null;
};

type Lane = "OPEN" | "ACKNOWLEDGED" | "COMPLETED";
const LANES: { key: Lane; title: string; empty: string }[] = [
  { key: "OPEN", title: "Bekliyor", empty: "Bekleyen talep yok." },
  { key: "ACKNOWLEDGED", title: "İlgileniliyor", empty: "Üstlenilmiş talep yok." },
  { key: "COMPLETED", title: "Tamamlandı", empty: "Bugün tamamlanan talep yok." },
];

const URGENCY_STYLES: Record<Urgency, string> = { normal: "ring-1 ring-border", warning: "ring-2 ring-warning", critical: "ring-[3px] ring-danger" };

// ─── Ses tercihi (bu cihazda hatırlanır; tarayıcı otomatik çalmaya izin vermez → kullanıcı açar) ───
const SOUND_KEY = "mn.service.sound";
const SOUND_EVENT = "mn-service-sound";
function subscribeSound(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(SOUND_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(SOUND_EVENT, cb);
  };
}
function readSound() {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}
function writeSound(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* gizli mod */
  }
  window.dispatchEvent(new Event(SOUND_EVENT));
}

/** Ön salon zili: yumuşak, üç notalı (mutfak uyarısından ayırt edilir). */
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  [659, 784, 988].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const at = t + i * 0.12;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}

export function ServiceBoard({
  open,
  acknowledged,
  done,
  metrics,
  abilities,
  serverNow,
  readOnly,
  timezone,
}: {
  open: ServiceCard[];
  acknowledged: ServiceCard[];
  done: ServiceCard[];
  metrics: { open: number; acknowledged: number; completedToday: number; avgResponseMs: number | null };
  abilities: ServiceAbilities;
  serverNow: number;
  readOnly: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [now, setNow] = useState(serverNow);
  const [tab, setTab] = useState<Lane>("OPEN");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [, startTransition] = useTransition();
  const soundOn = useSyncExternalStore(subscribeSound, readSound, () => false);
  const audioRef = useRef<AudioContext | null>(null);
  const knownRef = useRef<Set<string> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lanes: Record<Lane, ServiceCard[]> = { OPEN: open, ACKNOWLEDGED: acknowledged, COMPLETED: done };
  const time = useMemo(() => new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: timezone }), [timezone]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Canlı: yalnızca servis olayları panoyu yeniler (sipariş / KDS olayları değil). Yeniden bağlanınca tam yenileme.
  const streamState = useRealtimeStream(PANEL_EVENTS_URL, {
    onEvent: (event: RealtimeEnvelope) => {
      if (!event.type.startsWith("SERVICE_REQUEST_")) return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 200);
    },
    onReconnect: () => router.refresh(),
  });
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  // Yeni bekleyen talepte zil (ilk yüklemede değil).
  useEffect(() => {
    const ids = open.map((c) => c.id);
    const known = knownRef.current;
    if (known && soundOn && audioRef.current && ids.some((id) => !known.has(id))) chime(audioRef.current);
    knownRef.current = new Set([...(known ?? []), ...ids]);
  }, [open, soundOn]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => () => void audioRef.current?.close().catch(() => {}), []);

  function toggleSound() {
    if (!soundOn) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return toast("Bu tarayıcı sesli bildirimi desteklemiyor.", "error");
      audioRef.current ??= new Ctor();
      void audioRef.current.resume();
      chime(audioRef.current);
    }
    writeSound(!soundOn);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await boardRef.current?.requestFullscreen();
    } catch {
      toast("Tam ekran açılamadı.", "error");
    }
  }

  function act(card: ServiceCard, operation: "claim" | "complete" | "cancel") {
    setBusy(card.id);
    setConfirmCancel(null);
    startTransition(async () => {
      const result = await serviceRequestStaffAction(card.id, operation);
      setBusy(null);
      if (!result.ok) toast(result.error, "error");
      else if (result.message) toast(result.message, "success");
      router.refresh();
    });
  }

  return (
    <div ref={boardRef} className={cn("bg-bg", fullscreen && "overflow-auto p-4 sm:p-6")} data-testid="service-board">
      {/* Metrikler (gerçek veriden; veri yoksa "—") */}
      <dl className="mb-3 grid grid-cols-4 gap-2 sm:gap-3" data-testid="service-metrics">
        {[
          { label: "Bekleyen", value: String(metrics.open), id: "open" },
          { label: "İlgilenilen", value: String(metrics.acknowledged), id: "acknowledged" },
          { label: "Bugün Tamamlanan", value: String(metrics.completedToday), id: "completed" },
          { label: "Ortalama Yanıt Süresi", value: formatDurationShort(metrics.avgResponseMs), id: "avg" },
        ].map((m) => (
          <div key={m.id} className="min-w-0 rounded-lg border border-border bg-bg p-2 shadow-xs sm:p-4" data-metric={m.id}>
            <dt className="text-[0.6875rem] font-medium leading-tight text-fg-subtle sm:text-sm">{m.label}</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums sm:text-2xl">{m.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <ConnectionIndicator state={streamState} />
        <div className="flex flex-wrap gap-2">
          <Button variant={soundOn ? "primary" : "secondary"} onClick={toggleSound} aria-pressed={soundOn} className="min-h-12">
            {soundOn ? <BellRing aria-hidden="true" /> : <BellOff aria-hidden="true" />} {soundOn ? "Zil açık" : "Sesli Bildirim"}
          </Button>
          <span className="hidden sm:contents">
            <Button variant="secondary" onClick={toggleFullscreen} className="min-h-12">
              {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />} {fullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
            </Button>
          </span>
        </div>
      </div>

      {readOnly ? <p className="mb-4 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-muted">Destek modu — salt okunur görünüm.</p> : null}

      {/* Telefon / tablet: tek sütun + sekmeler (masaüstü kanbanı dar ekrana zorlanmaz) */}
      <div role="tablist" aria-label="Talep durumu" className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1 lg:hidden">
        {LANES.map((lane) => (
          <button
            key={lane.key}
            type="button"
            role="tab"
            aria-selected={tab === lane.key}
            aria-controls={`service-lane-${lane.key}`}
            onClick={() => setTab(lane.key)}
            data-testid={`service-tab-${lane.key}`}
            className={cn("min-h-12 rounded-lg px-1 text-sm font-semibold transition-colors", tab === lane.key ? "bg-bg text-fg shadow-sm" : "text-fg-subtle")}
          >
            {lane.title} <span className="tabular-nums">({lanes[lane.key].length})</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {LANES.map((lane) => {
          const list = lanes[lane.key];
          return (
            <section
              key={lane.key}
              id={`service-lane-${lane.key}`}
              aria-labelledby={`service-lane-title-${lane.key}`}
              data-testid={`service-lane-${lane.key}`}
              className={cn("min-w-0 rounded-xl bg-surface-2/60 p-2 sm:p-3", tab !== lane.key && "hidden lg:block")}
            >
              <h2 id={`service-lane-title-${lane.key}`} className="sr-only items-center justify-between px-1 pb-3 text-lg font-semibold lg:not-sr-only lg:flex">
                {lane.title}
                <span className="rounded-full bg-bg px-2.5 py-0.5 text-sm tabular-nums ring-1 ring-border">{list.length}</span>
              </h2>
              {list.length ? (
                <ol className="grid gap-3">
                  {list.map((card) => (
                    <Card
                      key={card.id}
                      card={card}
                      now={now}
                      time={time}
                      abilities={abilities}
                      busy={busy === card.id}
                      confirmingCancel={confirmCancel === card.id}
                      onClaim={() => act(card, "claim")}
                      onComplete={() => act(card, "complete")}
                      onCancel={() => (confirmCancel === card.id ? act(card, "cancel") : setConfirmCancel(card.id))}
                      onKeep={() => setConfirmCancel(null)}
                    />
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-subtle">{lane.empty}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({
  card,
  now,
  time,
  abilities,
  busy,
  confirmingCancel,
  onClaim,
  onComplete,
  onCancel,
  onKeep,
}: {
  card: ServiceCard;
  now: number;
  time: Intl.DateTimeFormat;
  abilities: ServiceAbilities;
  busy: boolean;
  confirmingCancel: boolean;
  onClaim: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onKeep: () => void;
}) {
  const Icon = SERVICE_TYPE_ICONS[card.type];
  const done = card.status === "COMPLETED";
  const waitingMs = (done && card.completedAt ? card.completedAt : now) - card.createdAt;
  const urgency: Urgency = card.status === "OPEN" ? serviceUrgency(waitingMs) : "normal";
  const handles = canHandleType(abilities, card.type);
  const canFinish = handles && card.status === "ACKNOWLEDGED" && (card.isMine || abilities.override);
  const responseMs = card.acknowledgedAt ? card.acknowledgedAt - card.createdAt : null;
  return (
    <li className={cn("rounded-xl bg-bg p-4 shadow-sm", URGENCY_STYLES[urgency])} data-testid="service-card" data-type={card.type} data-status={card.status} data-urgency={urgency} data-table={card.tableName}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight">{card.tableName}</p>
          <p className="text-sm text-fg-muted">
            {card.areaName ?? "Bölgesiz"}
            <span className="text-fg-subtle"> · {card.branchName}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("text-lg font-semibold tabular-nums", urgency === "critical" ? "text-danger" : urgency === "warning" ? "text-warning" : "text-fg-muted")} aria-label={done ? "Tamamlanma süresi" : "Bekleme süresi"}>
            {formatElapsed(waitingMs)}
          </p>
          <p className="text-xs text-fg-subtle tabular-nums">{time.format(card.createdAt)}</p>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-2 text-base font-semibold">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-surface-2">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        {SERVICE_TYPE_LABELS[card.type]}
        {card.orderNumber ? <span className="text-sm font-normal text-fg-subtle">· sipariş #{card.orderNumber}</span> : null}
      </p>
      {card.note ? <p className="mt-2 break-words rounded-md bg-warning-soft px-2.5 py-1.5 text-[0.9375rem] text-warning">“{card.note}”</p> : null}
      {card.assigneeName && card.status !== "OPEN" ? (
        <p className="mt-2 text-sm font-medium text-info" data-testid="service-assignee">
          {done ? `${card.assigneeName} ilgilendi` : `${card.assigneeName}${card.isMine ? " (siz)" : ""} ilgileniyor`}
          {responseMs !== null ? <span className="font-normal text-fg-subtle"> · yanıt {formatDurationShort(responseMs)}</span> : null}
        </p>
      ) : null}

      {card.status === "OPEN" && handles ? (
        <Button className="mt-4 min-h-12 w-full text-base" onClick={onClaim} disabled={busy} data-testid="service-claim">
          {busy ? "İşleniyor…" : "Ben ilgileniyorum"}
        </Button>
      ) : null}
      {canFinish ? (
        <Button className="mt-4 min-h-12 w-full text-base" variant="primary" onClick={onComplete} disabled={busy} data-testid="service-complete">
          {busy ? "İşleniyor…" : "Tamamlandı"}
        </Button>
      ) : null}
      {card.status === "ACKNOWLEDGED" && handles && !canFinish ? <p className="mt-3 text-sm text-fg-subtle">Yalnızca üstlenen personel ya da yönetici tamamlayabilir.</p> : null}
      {abilities.override && (card.status === "OPEN" || card.status === "ACKNOWLEDGED") ? (
        confirmingCancel ? (
          <div className="mt-2 flex gap-2" role="group" aria-label="İptali onayla">
            <Button variant="secondary" className="min-h-11 flex-1" onClick={onKeep}>
              Vazgeç
            </Button>
            <Button variant="danger" className="min-h-11 flex-1" onClick={onCancel} disabled={busy} data-testid="service-cancel-confirm">
              Talebi iptal et
            </Button>
          </div>
        ) : (
          <button type="button" onClick={onCancel} className="mt-2 min-h-11 w-full rounded-md text-sm text-fg-subtle hover:bg-surface-2 hover:text-fg" data-testid="service-cancel">
            İptal et (yanlış / mükerrer)
          </button>
        )
      ) : null}
    </li>
  );
}
