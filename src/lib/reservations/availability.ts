import { localParts, minuteLabel, zonedLocalToUtc } from "@/lib/reservations/time";

/**
 * Deterministik uygunluk motoru (AI YOK). Saf fonksiyonlar — sunucu, transaction içinde aynı kodu yeniden çalıştırır;
 * tarayıcıdaki uygunluk yalnızca bilgilendiricidir. Nihai bütünlük: şube kilidi + veritabanı EXCLUDE kısıtı.
 *
 * Aralıklar YARI-AÇIK: [başlangıç, bitiş). 18:00–20:00 ile 20:00–22:00 çakışmaz.
 * Masa doluluğu = [başlangıç, bitiş + temizlik payı). Pay yeni rezervasyonun KENDİ bloğuna da eklenir; böylece pay her
 * iki yönde korunur (önceki rezervasyonun payı + yeni rezervasyonun payı).
 */
export type Interval = { start: number; end: number };

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function occupancy(startsAt: Date, durationMinutes: number, bufferMinutes: number): Interval {
  const start = startsAt.getTime();
  return { start, end: start + (durationMinutes + bufferMinutes) * 60_000 };
}

export type EngineTable = {
  id: string;
  name: string;
  areaId: string | null;
  capacity: number | null;
  capacityMin: number | null;
  reservable: boolean;
  active: boolean;
  sortOrder: number;
};
export type EngineCombination = { id: string; name: string; tableIds: readonly string[]; active: boolean };
export type Busy = { tableId: string; start: number; end: number };
export type Assignment = { tableIds: string[]; capacity: number; combinationId: string | null; label: string; areaMatch: boolean };

export function tableFits(t: EngineTable, partySize: number): boolean {
  return t.active && t.reservable && t.capacity !== null && t.capacity >= partySize && (t.capacityMin ?? 1) <= partySize;
}

function freeAt(tableId: string, block: Interval, busy: readonly Busy[]): boolean {
  return !busy.some((b) => b.tableId === tableId && overlaps(b, block));
}

/**
 * Uygun tüm atamalar, tercih sırasıyla:
 *   1. tek masa: tercih edilen bölge önce, sonra EN KÜÇÜK yeterli kapasite (boşa koltuk en az), sonra sıra / ad
 *   2. tek masa yoksa yöneticinin tanımladığı birleşimler: bölge, en az fazla kapasite, en az masa
 * Dinamik (tanımsız) birleştirme YAPILMAZ.
 */
export function candidateAssignments(input: {
  tables: readonly EngineTable[];
  combinations: readonly EngineCombination[];
  busy: readonly Busy[];
  block: Interval;
  partySize: number;
  preferredAreaId: string | null;
}): Assignment[] {
  const { tables, block, busy, partySize, preferredAreaId } = input;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const areaMatch = (areaId: string | null) => !preferredAreaId || areaId === preferredAreaId;

  const singles = tables
    .filter((t) => tableFits(t, partySize) && freeAt(t.id, block, busy))
    .sort((a, b) => Number(areaMatch(b.areaId)) - Number(areaMatch(a.areaId)) || a.capacity! - b.capacity! || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"))
    .map((t) => ({ tableIds: [t.id], capacity: t.capacity!, combinationId: null, label: t.name, areaMatch: areaMatch(t.areaId) }));

  const combos: Assignment[] = [];
  for (const c of input.combinations) {
    if (!c.active || c.tableIds.length < 2) continue;
    const members = c.tableIds.map((id) => byId.get(id));
    if (members.some((m) => !m || !m.active || !m.reservable || m.capacity === null)) continue;
    const capacity = members.reduce((s, m) => s + m!.capacity!, 0);
    if (capacity < partySize) continue;
    if (!members.every((m) => freeAt(m!.id, block, busy))) continue;
    combos.push({ tableIds: members.map((m) => m!.id), capacity, combinationId: c.id, label: c.name, areaMatch: members.every((m) => areaMatch(m!.areaId)) });
  }
  combos.sort((a, b) => Number(b.areaMatch) - Number(a.areaMatch) || a.capacity - b.capacity || a.tableIds.length - b.tableIds.length || a.label.localeCompare(b.label, "tr"));
  return [...singles, ...combos];
}

export function bestAssignment(input: Parameters<typeof candidateAssignments>[0]): Assignment | null {
  return candidateAssignments(input)[0] ?? null;
}

/** Şubenin en büyük tek masa / birleşim kapasitesi (büyük grup mesajı için). */
export function maxSeatable(tables: readonly EngineTable[], combinations: readonly EngineCombination[]): number {
  const byId = new Map(tables.map((t) => [t.id, t]));
  let max = 0;
  for (const t of tables) if (t.active && t.reservable && t.capacity) max = Math.max(max, t.capacity);
  for (const c of combinations) {
    if (!c.active) continue;
    const members = c.tableIds.map((id) => byId.get(id));
    if (members.some((m) => !m || !m.active || !m.reservable || !m.capacity)) continue;
    max = Math.max(max, members.reduce((s, m) => s + m!.capacity!, 0));
  }
  return max;
}

export type OpeningInterval = { opensMinute: number; closesMinute: number };
export type Slot = { minute: number; label: string; startsAt: Date };

/**
 * Yerel bir gün için aday başlangıç saatleri: açılış aralıklarında `slotInterval` adımla; rezervasyon kapanıştan önce
 * BİTMELİ (başlangıç + süre ≤ kapanış). Yaz saati boşluğundaki saatler üretilmez; tekrar eden saat bir kez (ilk geçiş).
 */
export function daySlots(input: { date: string; timeZone: string; hours: readonly OpeningInterval[]; durationMinutes: number; slotIntervalMinutes: number }): Slot[] {
  const seen = new Set<number>();
  const out: Slot[] = [];
  const hours = [...input.hours].sort((a, b) => a.opensMinute - b.opensMinute);
  for (const h of hours) {
    for (let minute = h.opensMinute; minute + input.durationMinutes <= h.closesMinute && minute < 1440; minute += input.slotIntervalMinutes) {
      const z = zonedLocalToUtc(input.date, minute, input.timeZone);
      if (z.kind === "missing") continue;
      const t = z.at.getTime();
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ minute, label: minuteLabel(minute), startsAt: z.at });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Başlangıç anı (yerel saat) bir açılış aralığında ve rezervasyon kapanıştan önce bitiyor mu? (daySlots ile aynı kural) */
export function withinOpeningHours(startsAt: Date, durationMinutes: number, timeZone: string, hoursByWeekday: ReadonlyMap<number, readonly OpeningInterval[]>): boolean {
  const { minute, weekday } = localParts(startsAt, timeZone);
  return (hoursByWeekday.get(weekday) ?? []).some((h) => minute >= h.opensMinute && minute + durationMinutes <= h.closesMinute);
}

export function blackoutHit(block: Interval, blackouts: readonly Interval[]): boolean {
  return blackouts.some((b) => overlaps(b, block));
}
