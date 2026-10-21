import { describe, expect, it } from "vitest";
import { bestAssignment, blackoutHit, candidateAssignments, daySlots, maxSeatable, occupancy, overlaps, withinOpeningHours, type EngineCombination, type EngineTable } from "@/lib/reservations/availability";
import { DEFAULT_POLICY, deriveManageToken, hashIdempotency, hashManageToken, isManageTokenFormat, newManageNonce, policyViolation, reservationRequestHash } from "@/lib/reservations/rules";
import { ACTIVE_STATUSES, RESERVATION_TRANSITIONS, canCustomerCancel, canMarkNoShow, canTransition, isActiveStatus, lateMinutes, type ReservationStatusName } from "@/lib/reservations/status";
import { addDays, isValidDate, localDayBounds, localParts, parseMinuteLabel, weekdayOf, zonedLocalToUtc } from "@/lib/reservations/time";

/** Sprint 17 — rezervasyon saf kuralları. */
const MIN = 60_000;
const t = (id: string, capacity: number | null, extra: Partial<EngineTable> = {}): EngineTable => ({ id, name: id, areaId: "salon", capacity, capacityMin: null, reservable: true, active: true, sortOrder: 0, ...extra });
const at = (iso: string) => new Date(iso);

describe("aralıklar", () => {
  it("yarı-açık: 18–20 ile 20–22 çakışmaz; 19–21 çakışır", () => {
    const a = { start: 18 * 60, end: 20 * 60 };
    expect(overlaps(a, { start: 20 * 60, end: 22 * 60 })).toBe(false);
    expect(overlaps(a, { start: 19 * 60, end: 21 * 60 })).toBe(true);
    expect(overlaps(a, { start: 16 * 60, end: 18 * 60 })).toBe(false);
    expect(overlaps(a, { start: 18 * 60, end: 20 * 60 })).toBe(true);
  });
  it("doluluk = süre + temizlik payı", () => {
    const s = at("2026-06-10T15:00:00Z");
    expect(occupancy(s, 90, 0).end - s.getTime()).toBe(90 * MIN);
    expect(occupancy(s, 90, 15).end - s.getTime()).toBe(105 * MIN);
  });
  it("pay iki yönde korunur: önceki pay + yeni pay", () => {
    const first = occupancy(at("2026-06-10T15:00:00Z"), 120, 15); // 15:00–17:15 blok
    const adjacent = occupancy(at("2026-06-10T17:00:00Z"), 120, 15);
    const after = occupancy(at("2026-06-10T17:15:00Z"), 120, 15);
    const before = occupancy(at("2026-06-10T12:45:00Z"), 120, 15); // 12:45–15:00 blok
    expect(overlaps(first, adjacent)).toBe(true);
    expect(overlaps(first, after)).toBe(false);
    expect(overlaps(first, before)).toBe(false);
  });
});

describe("masa seçimi", () => {
  const block = { start: 0, end: 90 * MIN };
  it("en küçük yeterli masa (2 kişiye 8'lik değil 2'lik)", () => {
    const r = bestAssignment({ tables: [t("sekiz", 8), t("iki", 2), t("dort", 4)], combinations: [], busy: [], block, partySize: 2, preferredAreaId: null });
    expect(r?.tableIds).toEqual(["iki"]);
  });
  it("dolu masa atlanır; çakışmayan doluluk engel değildir", () => {
    const r = bestAssignment({ tables: [t("iki", 2), t("dort", 4)], combinations: [], busy: [{ tableId: "iki", start: 0, end: 60 * MIN }, { tableId: "dort", start: 90 * MIN, end: 200 * MIN }], block, partySize: 2, preferredAreaId: null });
    expect(r?.tableIds).toEqual(["dort"]);
  });
  it("bölge tercihi önce gelir, sonra en küçük", () => {
    const r = bestAssignment({ tables: [t("salon2", 2), t("bahce4", 4, { areaId: "bahce" })], combinations: [], busy: [], block, partySize: 2, preferredAreaId: "bahce" });
    expect(r).toMatchObject({ tableIds: ["bahce4"], areaMatch: true });
  });
  it("tercih edilen bölge doluysa başka bölge (tercih garanti değildir)", () => {
    const r = bestAssignment({ tables: [t("salon2", 2), t("bahce4", 4, { areaId: "bahce" })], combinations: [], busy: [{ tableId: "bahce4", start: 0, end: 999 * MIN }], block, partySize: 2, preferredAreaId: "bahce" });
    expect(r).toMatchObject({ tableIds: ["salon2"], areaMatch: false });
  });
  it("kapasitesi boş, rezervasyona kapalı, pasif ya da en az kişi şartını karşılamayan masa atanmaz (ad kapasite değildir)", () => {
    const tables = [t("Masa 8 kişilik", null), t("kapali", 4, { reservable: false }), t("pasif", 4, { active: false }), t("buyuk", 8, { capacityMin: 5 })];
    expect(bestAssignment({ tables, combinations: [], busy: [], block, partySize: 2, preferredAreaId: null })).toBeNull();
    expect(bestAssignment({ tables, combinations: [], busy: [], block, partySize: 6, preferredAreaId: null })?.tableIds).toEqual(["buyuk"]);
  });
  it("birleşim: tek masa yetmezse tanımlı birleşimlerden en az fazla kapasiteli; dinamik birleştirme yok", () => {
    const tables = [t("m4", 4), t("m5", 4), t("m6", 6), t("m7", 2)];
    const combos: EngineCombination[] = [
      { id: "c1", name: "4+5", tableIds: ["m4", "m5"], active: true },
      { id: "c2", name: "5+6", tableIds: ["m5", "m6"], active: true },
    ];
    expect(bestAssignment({ tables, combinations: combos, busy: [], block, partySize: 8, preferredAreaId: null })).toMatchObject({ combinationId: "c1", capacity: 8 });
    expect(bestAssignment({ tables, combinations: [], busy: [], block, partySize: 8, preferredAreaId: null })).toBeNull();
    // Üyesi dolu birleşim kullanılmaz
    expect(bestAssignment({ tables, combinations: combos, busy: [{ tableId: "m4", start: 0, end: 999 * MIN }], block, partySize: 8, preferredAreaId: null })).toMatchObject({ combinationId: "c2", capacity: 10 });
    // Tek masa yeterliyse birleşim seçilmez
    expect(candidateAssignments({ tables, combinations: combos, busy: [], block, partySize: 5, preferredAreaId: null })[0]).toMatchObject({ tableIds: ["m6"], combinationId: null });
  });
  it("en büyük oturtulabilir grup (büyük grup mesajı)", () => {
    expect(maxSeatable([t("a", 4), t("b", 6)], [{ id: "c", name: "a+b", tableIds: ["a", "b"], active: true }])).toBe(10);
    expect(maxSeatable([t("a", 4), t("b", null)], [{ id: "c", name: "a+b", tableIds: ["a", "b"], active: true }])).toBe(4);
  });
});

describe("açılış saatleri, kapalı dönem", () => {
  const tz = "Europe/Istanbul";
  it("slotlar kapanıştan önce biter; aralık adımı uygulanır", () => {
    const slots = daySlots({ date: "2026-06-10", timeZone: tz, hours: [{ opensMinute: 12 * 60, closesMinute: 15 * 60 }], durationMinutes: 90, slotIntervalMinutes: 30 });
    expect(slots.map((s) => s.label)).toEqual(["12:00", "12:30", "13:00", "13:30"]);
    expect(slots[0]!.startsAt.toISOString()).toBe("2026-06-10T09:00:00.000Z");
  });
  it("iki aralıklı gün (öğle + akşam)", () => {
    const slots = daySlots({ date: "2026-06-10", timeZone: tz, hours: [{ opensMinute: 18 * 60, closesMinute: 21 * 60 }, { opensMinute: 12 * 60, closesMinute: 14 * 60 }], durationMinutes: 120, slotIntervalMinutes: 60 });
    expect(slots.map((s) => s.label)).toEqual(["12:00", "18:00", "19:00"]);
  });
  it("kapalı saatte (03:00) rezervasyon kabul edilmez", () => {
    const hours = new Map([[3, [{ opensMinute: 12 * 60, closesMinute: 23 * 60 }]]]);
    expect(withinOpeningHours(zonedAt("2026-06-10", 3 * 60, tz), 90, tz, hours)).toBe(false);
    expect(withinOpeningHours(zonedAt("2026-06-10", 19 * 60, tz), 90, tz, hours)).toBe(true);
    expect(withinOpeningHours(zonedAt("2026-06-10", 22 * 60, tz), 90, tz, hours)).toBe(false); // kapanışı aşar
    expect(withinOpeningHours(zonedAt("2026-06-11", 19 * 60, tz), 90, tz, hours)).toBe(false); // perşembe tanımsız
  });
  it("kapalı dönem çakışması", () => {
    const blackout = [{ start: 100, end: 200 }];
    expect(blackoutHit({ start: 150, end: 250 }, blackout)).toBe(true);
    expect(blackoutHit({ start: 200, end: 250 }, blackout)).toBe(false);
  });
});

function zonedAt(date: string, minute: number, tz: string): Date {
  const r = zonedLocalToUtc(date, minute, tz);
  if (r.kind === "missing") throw new Error("missing");
  return r.at;
}

describe("politika", () => {
  const now = at("2026-06-10T12:00:00Z");
  const p = { ...DEFAULT_POLICY, enabled: true, minAdvanceMinutes: 30, maxAdvanceDays: 60, minPartySize: 1, maxPartySize: 8 };
  it("en erken / en ileri / geçmiş", () => {
    expect(policyViolation(p, { startsAt: new Date(now.getTime() + 20 * MIN), partySize: 2, now, channel: "public" })).toBe("too_soon");
    expect(policyViolation(p, { startsAt: new Date(now.getTime() + 40 * MIN), partySize: 2, now, channel: "public" })).toBeNull();
    expect(policyViolation(p, { startsAt: new Date(now.getTime() + 61 * 86_400_000), partySize: 2, now, channel: "public" })).toBe("too_far");
    expect(policyViolation(p, { startsAt: new Date(now.getTime() - 3600_000), partySize: 2, now, channel: "staff" })).toBe("in_past");
    // Personel için en erken sınırı yok (telefonla hemen gelecek misafir)
    expect(policyViolation(p, { startsAt: new Date(now.getTime() + 5 * MIN), partySize: 2, now, channel: "staff" })).toBeNull();
  });
  it("kişi sınırı: online en çok; personel büyük grubu girebilir", () => {
    expect(policyViolation(p, { startsAt: new Date(now.getTime() + 3600_000), partySize: 9, now, channel: "public" })).toBe("party_too_large");
    expect(policyViolation(p, { startsAt: new Date(now.getTime() + 3600_000), partySize: 9, now, channel: "staff" })).toBeNull();
    expect(policyViolation({ ...p, minPartySize: 2 }, { startsAt: new Date(now.getTime() + 3600_000), partySize: 1, now, channel: "public" })).toBe("party_too_small");
  });
});

describe("durum makinesi", () => {
  it("geçiş tablosu", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("PENDING", "SEATED")).toBe(false);
    expect(canTransition("CONFIRMED", "SEATED")).toBe(true);
    expect(canTransition("CONFIRMED", "NO_SHOW")).toBe(true);
    expect(canTransition("SEATED", "COMPLETED")).toBe(true);
    expect(canTransition("SEATED", "NO_SHOW")).toBe(false);
    for (const final of ["COMPLETED", "CANCELLED", "NO_SHOW"] as ReservationStatusName[]) expect(RESERVATION_TRANSITIONS[final]).toEqual([]);
    expect(ACTIVE_STATUSES).toEqual(["PENDING", "CONFIRMED", "SEATED"]);
    expect(isActiveStatus("COMPLETED")).toBe(false);
  });
  it("gelmedi: saat + bekleme payından sonra", () => {
    const r = { status: "CONFIRMED" as const, startsAt: at("2026-06-10T17:00:00Z") };
    expect(canMarkNoShow(r, at("2026-06-10T17:10:00Z"), 15)).toBe(false);
    expect(canMarkNoShow(r, at("2026-06-10T17:15:00Z"), 15)).toBe(true);
    expect(canMarkNoShow({ ...r, status: "SEATED" }, at("2026-06-10T18:00:00Z"), 15)).toBe(false);
  });
  it("müşteri iptali sınırdan önce; gecikme göstergesi otomatik iptal etmez", () => {
    const r = { status: "CONFIRMED" as const, startsAt: at("2026-06-10T17:00:00Z") };
    expect(canCustomerCancel(r, at("2026-06-10T15:59:00Z"), 60)).toBe(true);
    expect(canCustomerCancel(r, at("2026-06-10T16:01:00Z"), 60)).toBe(false);
    expect(canCustomerCancel(r, at("2026-06-10T16:59:00Z"), 0)).toBe(true);
    expect(canCustomerCancel({ ...r, status: "SEATED" }, at("2026-06-10T10:00:00Z"), 0)).toBe(false);
    expect(lateMinutes(r, at("2026-06-10T17:15:30Z"))).toBe(15);
    expect(lateMinutes(r, at("2026-06-10T16:50:00Z"))).toBeNull();
    expect(lateMinutes({ ...r, status: "SEATED" }, at("2026-06-10T17:30:00Z"))).toBeNull();
  });
});

describe("idempotency ve belirteç", () => {
  const base = { branchId: "b", startsAt: "2026-06-10T16:00:00.000Z", partySize: 2, guestName: "Ayşe", phone: "+905321234567", email: null, areaId: null, request: null };
  it("aynı içerik aynı özet; değişen içerik farklı", () => {
    expect(reservationRequestHash(base)).toBe(reservationRequestHash({ ...base }));
    expect(reservationRequestHash(base)).not.toBe(reservationRequestHash({ ...base, partySize: 3 }));
    expect(hashIdempotency("k1")).not.toBe(hashIdempotency("k2"));
  });
  it("yönetim belirteci 256 bit, nonce'tan yeniden türetilebilir; sunucuda yalnızca özeti", () => {
    const nonce = newManageNonce();
    const token = deriveManageToken("s".repeat(32), nonce);
    expect(isManageTokenFormat(token)).toBe(true);
    expect(token).toHaveLength(43);
    expect(deriveManageToken("s".repeat(32), nonce)).toBe(token);
    expect(deriveManageToken("x".repeat(32), nonce)).not.toBe(token);
    expect(hashManageToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashManageToken(token)).not.toContain(token);
    for (const bad of [undefined, "", "abc", "x".repeat(44), "cmaaaaaaaaaaaaaaaaaaaaaaa"]) expect(isManageTokenFormat(bad)).toBe(false);
  });
});

describe("saat dilimi ve yaz saati", () => {
  it("İstanbul (UTC+3, DST yok)", () => {
    expect(zonedLocalToUtc("2026-06-10", 19 * 60, "Europe/Istanbul")).toEqual({ kind: "ok", at: at("2026-06-10T16:00:00Z") });
    expect(localParts(at("2026-06-10T21:30:00Z"), "Europe/Istanbul")).toEqual({ date: "2026-06-11", minute: 30, weekday: 4 });
  });
  it("Berlin ileri alma: 02:30 yok → missing; slot üretilmez", () => {
    expect(zonedLocalToUtc("2026-03-29", 150, "Europe/Berlin")).toEqual({ kind: "missing" });
    expect(zonedLocalToUtc("2026-03-29", 180, "Europe/Berlin")).toEqual({ kind: "ok", at: at("2026-03-29T01:00:00Z") });
    const slots = daySlots({ date: "2026-03-29", timeZone: "Europe/Berlin", hours: [{ opensMinute: 60, closesMinute: 300 }], durationMinutes: 60, slotIntervalMinutes: 30 });
    expect(slots.map((s) => s.label)).toEqual(["01:00", "01:30", "03:00", "03:30", "04:00"]);
  });
  it("Berlin geri alma: 02:30 iki kez → ilk geçiş; slot bir kez", () => {
    const r = zonedLocalToUtc("2026-10-25", 150, "Europe/Berlin");
    expect(r).toEqual({ kind: "ambiguous", at: at("2026-10-25T00:30:00Z"), later: at("2026-10-25T01:30:00Z") });
    const slots = daySlots({ date: "2026-10-25", timeZone: "Europe/Berlin", hours: [{ opensMinute: 120, closesMinute: 240 }], durationMinutes: 30, slotIntervalMinutes: 30 });
    expect(slots.map((s) => s.label)).toEqual(["02:00", "02:30", "03:00", "03:30"]);
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(4);
  });
  it("yerel gün sınırları: DST günleri 23 / 25 saat", () => {
    const spring = localDayBounds("2026-03-29", "Europe/Berlin");
    const fall = localDayBounds("2026-10-25", "Europe/Berlin");
    expect((spring.end.getTime() - spring.start.getTime()) / 3600_000).toBe(23);
    expect((fall.end.getTime() - fall.start.getTime()) / 3600_000).toBe(25);
    const ist = localDayBounds("2026-06-10", "Europe/Istanbul");
    expect(ist.start.toISOString()).toBe("2026-06-09T21:00:00.000Z");
  });
  it("tarih yardımcıları", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-10-12")).toBe(1);
    expect(weekdayOf("2026-10-18")).toBe(7);
    expect(parseMinuteLabel("19:30")).toBe(1170);
    expect(parseMinuteLabel("24:00")).toBeNull();
  });
});
