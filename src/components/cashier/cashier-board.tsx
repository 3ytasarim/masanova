"use client";

import { BellOff, BellRing, Banknote, CreditCard, ExternalLink, LogOut, Maximize, Minimize, Printer, Receipt, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { openFor, type BillLine } from "@/lib/cashier/bill";
import { formatMoney } from "@/lib/menu/money";
import { formatOrderNumber } from "@/lib/orders/status";
import { cn } from "@/lib/utils/cn";
import { cashierLogoutAction } from "@/server/actions/auth.actions";
import { closeTableBillAction, markBillPrintedAction } from "@/server/actions/cashier.actions";
import { useRealtimeStream } from "@/hooks/use-realtime-stream";
import { ConnectionIndicator, PANEL_EVENTS_URL } from "@/components/realtime/live-refresh";
import { useToast } from "@/components/ui/toast";

export type CashierBillView = {
  tableId: string;
  currency: string;
  orderIds: string[];
  orderNumbers: number[];
  openedAt: number;
  lines: BillLine[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
};
export type CashierTableView = {
  id: string;
  name: string;
  area: string | null;
  branch: string;
  pendingOrders: number;
  billRequest: { at: number; printed: boolean } | null;
  bill: CashierBillView | null;
};

type Filter = "all" | "open" | "bill" | "empty";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "open", label: "Açık" },
  { key: "bill", label: "Hesap isteyen" },
  { key: "empty", label: "Boş" },
];

const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32).padEnd(16, "0");

/**
 * Kasa ekranı (dokunmatik POS). Masalar; QR'dan "Hesap" isteyen masa yanıp söner. Masaya dokun → adisyon → yazdır
 * (80 mm fiş, tarayıcı yazdırma) → Nakit / Kart ile kapat (mevcut kasa kaydı). Canlı akış + 30 sn emniyet yenilemesi.
 */
/** Kasa terminali oturumu bu aralıkla uzatılır (oturum 7 gün kayar; ekran açık kaldıkça kapanmaz). */
const KEEPALIVE_MS = 3 * 60 * 60 * 1000;

export function CashierBoard({
  restaurantName,
  userName,
  currency,
  tables,
  serverNow,
  canAct,
  standalone = false,
}: {
  restaurantName: string;
  userName?: string;
  currency: string;
  tables: CashierTableView[];
  serverNow: number;
  canAct: boolean;
  /** /kasa terminali: panel çerçevesi yok, oturum açık tutulur, çıkış düğmesi. */
  standalone?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [now, setNow] = useState(serverNow);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"CASH" | "CARD_TERMINAL" | null>(null);
  const [printing, setPrinting] = useState<CashierTableView | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Zil: kasa terminalinde varsayılan AÇIK; tercih bu cihazda hatırlanır.
  const soundOn = useSyncExternalStore(subscribeSoundPref, () => readSoundPref(standalone), () => standalone);
  const [logoutArmed, setLogoutArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const boardRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const knownRequests = useRef<Set<string> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeKey = useRef(newKey());

  const money = (minor: number) => formatMoney(minor, currency, "tr-TR");
  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const requesting = tables.filter((t) => t.billRequest);
  const openTables = tables.filter((t) => t.bill);
  const openTotal = openTables.reduce((n, t) => n + (t.bill?.remainingMinor ?? 0), 0);
  const multiBranch = new Set(tables.map((t) => t.branch)).size > 1;

  const visible = useMemo(
    () => tables.filter((t) => (filter === "open" ? !!t.bill : filter === "bill" ? !!t.billRequest : filter === "empty" ? !t.bill && !t.billRequest : true)),
    [tables, filter],
  );
  const groups = useMemo(() => {
    const map = new Map<string, CashierTableView[]>();
    for (const t of visible) {
      const label = [multiBranch ? t.branch : null, t.area ?? "Bölgesiz"].filter(Boolean).join(" · ");
      map.set(label, [...(map.get(label) ?? []), t]);
    }
    return [...map];
  }, [visible, multiBranch]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const refresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  };
  const streamState = useRealtimeStream(PANEL_EVENTS_URL, { onEvent: refresh, onReconnect: () => router.refresh() });
  // Emniyet: ödeme kayıtları canlı olay üretmez → başka kasadaki kapanış en geç 30 sn'de yansır.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => {
      clearInterval(id);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [router]);

  // Kasa terminali: oturumu açık tut (açılışta + birkaç saatte bir); oturum düştüyse kasa girişine.
  useEffect(() => {
    if (!standalone) return;
    const ping = () =>
      fetch("/kasa/oturum", { method: "POST", cache: "no-store" })
        .then((r) => {
          if (r.status === 401) router.replace("/giris?sonra=kasa");
        })
        .catch(() => undefined);
    void ping();
    const id = setInterval(ping, KEEPALIVE_MS);
    return () => clearInterval(id);
  }, [standalone, router]);
  useEffect(() => {
    if (!logoutArmed) return;
    const id = setTimeout(() => setLogoutArmed(false), 4000);
    return () => clearTimeout(id);
  }, [logoutArmed]);

  // Ses: tarayıcı ilk dokunuşa kadar sesi engeller → zil açıksa ekrana ilk dokunuşta ses kendiliğinden etkinleşir.
  const ensureAudio = (): AudioContext | null => {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioRef.current ??= new Ctor();
    if (audioRef.current.state === "suspended") void audioRef.current.resume().catch(() => undefined);
    return audioRef.current;
  };
  useEffect(() => {
    if (!soundOn) return;
    const unlock = () => void ensureAudio();
    unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [soundOn]);

  // Yeni "Hesap" talebi (QR'dan ya da sesli garsona söyleyerek): zil çalar (ilk yüklemede değil).
  const unprinted = requesting.filter((t) => !t.billRequest!.printed);
  useEffect(() => {
    const ids = unprinted.map((t) => `${t.id}:${t.billRequest!.at}`);
    const known = knownRequests.current;
    if (known && soundOn && ids.some((id) => !known.has(id))) {
      const ctx = ensureAudio();
      if (ctx) chime(ctx);
    }
    knownRequests.current = new Set([...(known ?? []), ...ids]);
  });
  // Hatırlatma: adisyonu basılmamış hesap talebi varken zil 45 sn'de bir yeniden çalar.
  const hasUnprinted = unprinted.length > 0;
  useEffect(() => {
    if (!soundOn || !hasUnprinted) return;
    const id = setInterval(() => {
      const ctx = ensureAudio();
      if (ctx) chime(ctx);
    }, 45_000);
    return () => clearInterval(id);
  }, [soundOn, hasUnprinted]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => () => void audioRef.current?.close().catch(() => {}), []);

  // Yazdırma: fiş DOM'a girdikten sonra yazdır; bitince temizle.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    window.addEventListener("afterprint", done, { once: true });
    const id = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  function toggleSound() {
    const next = !soundOn;
    if (next) {
      const ctx = ensureAudio();
      if (!ctx) return toast("Bu tarayıcı sesli uyarıyı desteklemiyor.", "error");
      chime(ctx);
    }
    writeSoundPref(next);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await boardRef.current?.requestFullscreen();
    } catch {
      toast("Tam ekran açılamadı.", "error");
    }
  }

  function open(table: CashierTableView) {
    setSelectedId(table.id);
    setConfirm(null);
    closeKey.current = newKey();
  }

  function print(table: CashierTableView) {
    if (!table.bill) return;
    setPrinting(table);
    if (canAct && table.billRequest && !table.billRequest.printed)
      startTransition(async () => {
        await markBillPrintedAction(table.id);
        router.refresh();
      });
  }

  function close(table: CashierTableView, method: "CASH" | "CARD_TERMINAL") {
    startTransition(async () => {
      const r = await closeTableBillAction({ tableId: table.id, method, key: closeKey.current });
      if (r.ok) {
        toast(`${table.name} kapatıldı · ${money(r.data.paidMinor)} ${method === "CASH" ? "nakit" : "kart"}`, "success");
        setSelectedId(null);
        setConfirm(null);
      } else toast(r.error, "error");
      router.refresh();
    });
  }

  return (
    <div ref={boardRef} data-testid="cashier-board" className={cn("bg-stone-950 text-white", fullscreen ? "h-screen overflow-auto p-4 sm:p-6" : standalone ? "min-h-dvh p-4 sm:p-6" : "rounded-3xl p-4 sm:p-5")}>
      {/* Üst çubuk */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 shadow-lg shadow-orange-500/20">
            <Receipt aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{standalone ? restaurantName : "Kasa"}</h1>
            <p className="text-xs text-white/50">
              {standalone && userName ? `Kasa · ${userName} · ` : ""}
              {new Date(now).toLocaleString("tr-TR", { weekday: "long", hour: "2-digit", minute: "2-digit" })} · <ConnectionIndicator state={streamState} />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Stat label="Açık masa" value={String(openTables.length)} />
          <Stat label="Hesap isteyen" value={String(requesting.length)} alert={requesting.some((t) => !t.billRequest!.printed)} />
          <Stat label="Açık tutar" value={money(openTotal)} />
          <IconButton onClick={toggleSound} label={soundOn ? "Sesli uyarıyı kapat" : "Sesli uyarıyı aç"} active={soundOn}>
            {soundOn ? <BellRing className="size-5" /> : <BellOff className="size-5" />}
          </IconButton>
          <IconButton onClick={toggleFullscreen} label={fullscreen ? "Tam ekrandan çık" : "Tam ekran"}>
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </IconButton>
          {standalone ? (
            logoutArmed ? (
              <form action={cashierLogoutAction}>
                <button type="submit" className="flex h-12 items-center gap-2 rounded-2xl bg-rose-600 px-4 text-sm font-semibold ring-1 ring-rose-300/40" data-testid="cashier-logout-confirm">
                  <LogOut className="size-5" /> Çıkışı onayla
                </button>
              </form>
            ) : (
              <IconButton onClick={() => setLogoutArmed(true)} label="Çıkış yap">
                <LogOut className="size-5" />
              </IconButton>
            )
          ) : (
            <Link href="/kasa" target="_blank" className="flex h-12 items-center gap-2 rounded-2xl bg-white/5 px-4 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10" data-testid="cashier-terminal-link">
              <ExternalLink className="size-4" /> Kasa terminali
            </Link>
          )}
        </div>
      </div>

      {/* Hesap isteyenler şeridi */}
      {requesting.length ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" data-testid="cashier-requests">
          {requesting.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => open(t)}
              className={cn(
                "flex min-h-14 shrink-0 items-center gap-2.5 rounded-2xl px-4 text-left font-semibold ring-1",
                t.billRequest!.printed ? "bg-amber-500/15 text-amber-200 ring-amber-400/30" : "bg-rose-600 text-white ring-rose-300/40 motion-safe:animate-bill-flash",
              )}
            >
              <BellRing aria-hidden="true" className={cn("size-5", !t.billRequest!.printed && "motion-safe:animate-[wiggle_0.9s_ease-in-out_infinite]")} />
              <span>
                {t.name}
                <span className="block text-xs font-medium opacity-80">{t.billRequest!.printed ? "Yazdırıldı · ödeme bekleniyor" : `Hesap istedi · ${openFor(t.billRequest!.at, now)}`}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Filtre */}
      <div className="mt-4 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Masa filtresi">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn("min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors", filter === f.key ? "bg-white text-stone-950" : "bg-white/5 text-white/70 hover:bg-white/10")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Masalar */}
      <div className="mt-5 grid gap-6">
        {groups.length === 0 ? <p className="py-16 text-center text-white/50">Bu filtrede masa yok.</p> : null}
        {groups.map(([label, list]) => (
          <section key={label} aria-label={label}>
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-white/40">{label}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
              {list.map((t) => (
                <TableTile key={t.id} table={t} now={now} money={money} onOpen={() => open(t)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Adisyon paneli */}
      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${selected.name} adisyonu`} onClick={() => setSelectedId(null)}>
          <div className="flex h-full w-full max-w-md flex-col bg-stone-900 text-white shadow-2xl motion-safe:animate-[sheet-in-right_220ms_cubic-bezier(0.16,1,0.3,1)]" onClick={(e) => e.stopPropagation()} data-testid="cashier-bill">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-white/40">{[selected.area, multiBranch ? selected.branch : null].filter(Boolean).join(" · ") || "Masa"}</p>
                <h2 className="text-2xl font-semibold">{selected.name}</h2>
                {selected.bill ? (
                  <p className="mt-1 text-sm text-white/55">
                    {selected.bill.orderNumbers.map((n) => formatOrderNumber(n)).join(", ")} · {openFor(selected.bill.openedAt, now)} açık
                  </p>
                ) : null}
              </div>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Kapat" className="grid size-12 place-items-center rounded-2xl bg-white/5 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </div>

            {selected.bill ? (
              <>
                <ul className="flex-1 divide-y divide-white/5 overflow-y-auto px-5">
                  {selected.bill.lines.map((l, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          <span className="me-2 inline-block min-w-7 rounded-lg bg-white/10 px-1.5 text-center text-sm">{l.quantity}×</span>
                          {l.name}
                        </p>
                        {l.detail ? <p className="mt-0.5 ps-9 text-xs text-white/45">{l.detail}</p> : null}
                      </div>
                      <span className="shrink-0 tabular-nums">{money(l.totalMinor)}</span>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-white/10 p-5">
                  <dl className="grid gap-1.5 text-sm">
                    {selected.bill.discountMinor ? <Row label="İndirim" value={`−${money(selected.bill.discountMinor)}`} /> : null}
                    {selected.bill.paidMinor ? <Row label="Ödenen" value={`−${money(selected.bill.paidMinor)}`} /> : null}
                    <div className="mt-1 flex items-baseline justify-between">
                      <dt className="text-white/60">Ödenecek</dt>
                      <dd className="text-3xl font-semibold tabular-nums">{money(selected.bill.remainingMinor)}</dd>
                    </div>
                  </dl>
                  {selected.pendingOrders ? <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{selected.pendingOrders} sipariş henüz onaylanmadı; adisyona dahil değil.</p> : null}

                  <button type="button" onClick={() => print(selected)} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-semibold text-stone-950 hover:bg-white/90" data-testid="cashier-print">
                    <Printer className="size-5" /> Adisyonu yazdır
                  </button>
                  {canAct ? (
                    confirm ? (
                      <div className="mt-3 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10" data-testid="cashier-confirm">
                        <p className="text-center text-sm">
                          <strong className="text-base">{money(selected.bill.remainingMinor)}</strong> {confirm === "CASH" ? "nakit" : "kartla"} alındı olarak kaydedilsin mi?
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setConfirm(null)} className="min-h-12 rounded-xl bg-white/10 font-semibold hover:bg-white/15">
                            Vazgeç
                          </button>
                          <button type="button" disabled={pending} onClick={() => close(selected, confirm)} className="min-h-12 rounded-xl bg-emerald-500 font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-60" data-testid="cashier-confirm-ok">
                            {pending ? "Kaydediliyor…" : "Onayla, kapat"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setConfirm("CASH")} className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl bg-emerald-500 font-semibold text-stone-950 hover:bg-emerald-400" data-testid="cashier-cash">
                          <Banknote className="size-6" /> Nakit
                        </button>
                        <button type="button" onClick={() => setConfirm("CARD_TERMINAL")} className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl bg-sky-500 font-semibold text-stone-950 hover:bg-sky-400" data-testid="cashier-card">
                          <CreditCard className="size-6" /> Kart
                        </button>
                      </div>
                    )
                  ) : (
                    <p className="mt-3 text-center text-xs text-white/45">Ödeme alma yetkiniz yok (salt okunur).</p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-white/55">
                <Receipt className="size-10 opacity-40" />
                <p>Bu masada açık hesap yok.</p>
                {selected.pendingOrders ? <p className="text-sm text-amber-200">{selected.pendingOrders} sipariş onay bekliyor.</p> : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {printing?.bill ? <PrintReceipt restaurantName={restaurantName} table={printing} money={money} /> : null}
    </div>
  );
}

function TableTile({ table: t, now, money, onOpen }: { table: CashierTableView; now: number; money: (n: number) => string; onOpen: () => void }) {
  const asking = !!t.billRequest && !t.billRequest.printed;
  const awaiting = !!t.billRequest?.printed;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="cashier-table"
      data-state={asking ? "bill" : awaiting ? "printed" : t.bill ? "open" : "empty"}
      className={cn(
        "relative flex min-h-32 flex-col justify-between rounded-3xl p-4 text-left ring-1 transition-transform active:scale-[0.98]",
        asking
          ? "bg-gradient-to-br from-rose-600 to-red-700 ring-rose-300/50 motion-safe:animate-bill-flash motion-reduce:ring-4"
          : awaiting
            ? "bg-gradient-to-br from-amber-500/25 to-orange-600/20 ring-amber-400/40"
            : t.bill
              ? "bg-white/[0.07] ring-white/10 hover:bg-white/10"
              : "bg-white/[0.02] ring-white/5 text-white/45 hover:bg-white/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-lg font-semibold leading-tight">{t.name}</span>
        {asking ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-rose-700">Hesap</span>
        ) : t.pendingOrders ? (
          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[0.6875rem] font-bold text-stone-950">+{t.pendingOrders}</span>
        ) : null}
      </div>
      {t.bill ? (
        <div>
          <p className="text-2xl font-semibold tabular-nums">{money(t.bill.remainingMinor)}</p>
          <p className={cn("text-xs", asking ? "text-white/85" : "text-white/50")}>
            {asking ? `Hesap istedi · ${openFor(t.billRequest!.at, now)}` : awaiting ? "Yazdırıldı · ödeme bekleniyor" : `${t.bill.orderIds.length} sipariş · ${openFor(t.bill.openedAt, now)}`}
          </p>
        </div>
      ) : (
        <p className="text-sm">{asking ? "Hesap istedi" : "Boş"}</p>
      )}
    </button>
  );
}

/** 80 mm fiş (yalnızca yazdırırken görünür; globals.css › .mn-receipt). Mali değeri yoktur — bilgi fişi. */
function PrintReceipt({ restaurantName, table, money }: { restaurantName: string; table: CashierTableView; money: (n: number) => string }) {
  const bill = table.bill!;
  const at = new Date();
  return (
    <div className="mn-receipt" aria-hidden="true">
      <p className="mn-r-center mn-r-title">{restaurantName}</p>
      <p className="mn-r-center">ADİSYON</p>
      <p className="mn-r-row">
        <span>{[table.area, table.name].filter(Boolean).join(" · ")}</span>
        <span>{at.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </p>
      <p>Sipariş: {bill.orderNumbers.map((n) => formatOrderNumber(n)).join(", ")}</p>
      <hr />
      {bill.lines.map((l, i) => (
        <div key={i}>
          <p className="mn-r-row">
            <span>
              {l.quantity} x {l.name}
            </span>
            <span>{money(l.totalMinor)}</span>
          </p>
          {l.detail ? <p className="mn-r-detail">{l.detail}</p> : null}
        </div>
      ))}
      <hr />
      <p className="mn-r-row">
        <span>Ara toplam</span>
        <span>{money(bill.subtotalMinor)}</span>
      </p>
      {bill.discountMinor ? (
        <p className="mn-r-row">
          <span>İndirim</span>
          <span>-{money(bill.discountMinor)}</span>
        </p>
      ) : null}
      {bill.paidMinor ? (
        <p className="mn-r-row">
          <span>Ödenen</span>
          <span>-{money(bill.paidMinor)}</span>
        </p>
      ) : null}
      <p className="mn-r-row mn-r-total">
        <span>TOPLAM</span>
        <span>{money(bill.remainingMinor)}</span>
      </p>
      <hr />
      <p className="mn-r-center">Bilgi fişidir · Mali değeri yoktur</p>
      <p className="mn-r-center">Afiyet olsun!</p>
    </div>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={cn("min-h-12 rounded-2xl px-3.5 py-1.5 ring-1", alert ? "bg-rose-600/20 ring-rose-400/40" : "bg-white/5 ring-white/10")}>
      <p className="text-[0.625rem] uppercase tracking-[0.12em] text-white/45">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function IconButton({ onClick, label, active = false, children }: { onClick: () => void; label: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active} className={cn("grid size-12 place-items-center rounded-2xl ring-1 transition-colors", active ? "bg-orange-500 text-white ring-orange-300/40" : "bg-white/5 ring-white/10 hover:bg-white/10")}>
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-white/60">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

const SOUND_KEY = "mn_cashier_sound";
function readSoundPref(standalone: boolean): boolean {
  try {
    const v = typeof window === "undefined" ? null : window.localStorage.getItem(SOUND_KEY);
    return v === null ? standalone : v === "1";
  } catch {
    return standalone;
  }
}
function writeSoundPref(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* özel pencere vb. — yok say */
  }
  window.dispatchEvent(new Event(SOUND_EVENT));
}
const SOUND_EVENT = "mn-cashier-sound";
function subscribeSoundPref(onChange: () => void) {
  window.addEventListener(SOUND_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SOUND_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Hesap zili: masa zili gibi iki kez "din-don-din" (KDS bip'inden ayırt edilir). */
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (const [offset, freq] of [
    [0, 988],
    [0.18, 1319],
    [0.36, 1568],
    [0.9, 988],
    [1.08, 1319],
    [1.26, 1568],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, t + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.25);
  }
}
