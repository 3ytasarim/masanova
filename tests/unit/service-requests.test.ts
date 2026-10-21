import { describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { sanitizeNote } from "@/lib/orders/notes";
import { serviceStrings } from "@/lib/public-menu/i18n-service";
import { parseEnvelope, SERVICE_EVENT_BY_STATUS } from "@/lib/realtime/events";
import { activeSlotFor, findActiveDuplicate, SERVICE_RATE_LIMITS } from "@/lib/service-requests/duplicate";
import {
  canClaim,
  canComplete,
  canCustomerCancel,
  canHandleType,
  canStaffCancel,
  canTransitionService,
  isActiveService,
  serviceAbilities,
  SERVICE_TRANSITIONS,
} from "@/lib/service-requests/status";
import { averageMs, completionMs, formatDurationShort, responseMs, serviceUrgency, SERVICE_URGENCY, zonedDayBounds } from "@/lib/service-requests/timing";
import { SERVICE_NOTE_MAX, SERVICE_REQUEST_TYPES, staffDisplayName } from "@/lib/service-requests/types";
import { getRealtimeProvider, publishServiceRequest, tableChannel, tenantOrdersChannel } from "@/server/realtime/bus";

/** Sprint 8 — servis talebi kuralları (saf): durum, yetki, mükerrer politika, süreler, olaylar, dil. */

describe("durum makinesi", () => {
  it("OPEN → ACKNOWLEDGED → COMPLETED; iptal OPEN / ACKNOWLEDGED'dan; terminaller kapalı", () => {
    expect(canTransitionService("OPEN", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionService("ACKNOWLEDGED", "COMPLETED")).toBe(true);
    expect(canTransitionService("OPEN", "CANCELLED")).toBe(true);
    expect(canTransitionService("ACKNOWLEDGED", "CANCELLED")).toBe(true);
    expect(canTransitionService("OPEN", "COMPLETED")).toBe(false); // önce üstlenilir
    expect(canTransitionService("ACKNOWLEDGED", "OPEN")).toBe(false); // geri dönüş / bırakma yok
    expect(SERVICE_TRANSITIONS.COMPLETED).toEqual([]);
    expect(SERVICE_TRANSITIONS.CANCELLED).toEqual([]);
    expect(isActiveService("OPEN") && isActiveService("ACKNOWLEDGED")).toBe(true);
    expect(isActiveService("COMPLETED") || isActiveService("CANCELLED")).toBe(false);
  });
});

describe("rol yetenekleri ve üstlenme / tamamlama kuralları", () => {
  const a = (role: UserRole, readOnly = false) => serviceAbilities(role, { readOnly });
  const req = (over: Partial<{ type: "WAITER" | "BILL"; status: "OPEN" | "ACKNOWLEDGED" | "COMPLETED" | "CANCELLED"; acknowledgedByUserId: string | null }> = {}) => ({
    type: "WAITER" as const,
    status: "OPEN" as const,
    acknowledgedByUserId: null,
    ...over,
  });

  it("matris: sahip / müdür tam + override; garson yönetir; kasiyer yalnızca hesap; mutfak / bar yok; destek salt okunur", () => {
    expect(a("TENANT_OWNER")).toEqual({ view: true, manage: true, billOnly: false, override: true });
    expect(a("BRANCH_MANAGER")).toEqual({ view: true, manage: true, billOnly: false, override: true });
    expect(a("WAITER")).toEqual({ view: true, manage: true, billOnly: false, override: false });
    expect(a("CASHIER")).toEqual({ view: true, manage: false, billOnly: true, override: false });
    expect(a("KITCHEN").view || a("BAR").view).toBe(false);
    expect(a("TENANT_OWNER", true)).toEqual({ view: true, manage: false, billOnly: false, override: false });
    expect(canHandleType(a("CASHIER"), "BILL")).toBe(true);
    expect(canHandleType(a("CASHIER"), "WATER")).toBe(false);
  });

  it("üstlenme yalnızca OPEN; ikinci üstlenme 'wrong_status'", () => {
    expect(canClaim({ userId: "w1", abilities: a("WAITER") }, req())).toEqual({ ok: true });
    expect(canClaim({ userId: "w2", abilities: a("WAITER") }, req({ status: "ACKNOWLEDGED", acknowledgedByUserId: "w1" }))).toEqual({ ok: false, reason: "wrong_status" });
    expect(canClaim({ userId: "k", abilities: a("KITCHEN") }, req())).toEqual({ ok: false, reason: "forbidden" });
    expect(canClaim({ userId: "c", abilities: a("CASHIER") }, req({ type: "BILL" }))).toEqual({ ok: true });
    expect(canClaim({ userId: "c", abilities: a("CASHIER") }, req())).toEqual({ ok: false, reason: "forbidden" });
  });

  it("tamamlama: üstlenen ya da yönetici; başka garson yapamaz; OPEN tamamlanamaz", () => {
    const claimed = req({ status: "ACKNOWLEDGED", acknowledgedByUserId: "w1" });
    expect(canComplete({ userId: "w1", abilities: a("WAITER") }, claimed)).toEqual({ ok: true });
    expect(canComplete({ userId: "w2", abilities: a("WAITER") }, claimed)).toEqual({ ok: false, reason: "not_assignee" });
    expect(canComplete({ userId: "m", abilities: a("BRANCH_MANAGER") }, claimed)).toEqual({ ok: true });
    expect(canComplete({ userId: "w1", abilities: a("WAITER") }, req())).toEqual({ ok: false, reason: "wrong_status" });
    expect(canComplete({ userId: "o", abilities: a("TENANT_OWNER", true) }, claimed)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("iptal: personelde yalnızca yönetici; müşteri yalnızca OPEN", () => {
    expect(canStaffCancel({ userId: "w", abilities: a("WAITER") }, req()).ok).toBe(false);
    expect(canStaffCancel({ userId: "m", abilities: a("BRANCH_MANAGER") }, req({ status: "ACKNOWLEDGED", acknowledgedByUserId: "w" })).ok).toBe(true);
    expect(canStaffCancel({ userId: "m", abilities: a("BRANCH_MANAGER") }, req({ status: "COMPLETED" }))).toEqual({ ok: false, reason: "wrong_status" });
    expect(canCustomerCancel({ status: "OPEN" })).toBe(true);
    expect(canCustomerCancel({ status: "ACKNOWLEDGED" })).toBe(false);
  });
});

describe("mükerrer talep politikası", () => {
  it("masa + tip başına tek aktif; kapanan talep yenisini engellemez", () => {
    const list = [
      { type: "WATER" as const, status: "COMPLETED" as const },
      { type: "WAITER" as const, status: "ACKNOWLEDGED" as const },
    ];
    expect(findActiveDuplicate(list, "WAITER")?.status).toBe("ACKNOWLEDGED");
    expect(findActiveDuplicate(list, "WATER")).toBeNull();
    expect(activeSlotFor("OPEN")).toBe("ACTIVE");
    expect(activeSlotFor("ACKNOWLEDGED")).toBe("ACTIVE");
    expect(activeSlotFor("COMPLETED")).toBeNull();
    expect(activeSlotFor("CANCELLED")).toBeNull();
    expect(SERVICE_RATE_LIMITS.tableType.limit).toBeLessThan(SERVICE_RATE_LIMITS.table.limit);
    expect(SERVICE_RATE_LIMITS.table.limit).toBeLessThan(SERVICE_RATE_LIMITS.ip.limit);
  });
});

describe("süreler ve aciliyet", () => {
  const t0 = new Date("2026-10-11T10:00:00Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it("yanıt = üstlenme − oluşturma; tamamlanma = tamamlama − oluşturma; ortalama yalnızca gerçek veriden", () => {
    expect(responseMs({ createdAt: t0, acknowledgedAt: at(95), completedAt: null })).toBe(95_000);
    expect(completionMs({ createdAt: t0, acknowledgedAt: at(95), completedAt: at(300) })).toBe(300_000);
    expect(responseMs({ createdAt: t0, acknowledgedAt: null, completedAt: null })).toBeNull();
    expect(averageMs([60_000, null, 120_000])).toBe(90_000);
    expect(averageMs([null])).toBeNull();
    expect(formatDurationShort(null)).toBe("—");
    expect(formatDurationShort(45_000)).toBe("45 sn");
    expect(formatDurationShort(125_000)).toBe("2 dk 05 sn");
    expect(formatDurationShort(3_840_000)).toBe("1 sa 04 dk");
  });

  it("ön salon aciliyeti: 3 dk uyarı, 7 dk kritik (varsayılan; yapılandırılabilir)", () => {
    expect(SERVICE_URGENCY).toEqual({ warningMinutes: 3, criticalMinutes: 7 });
    expect(serviceUrgency(2 * 60_000 + 59_000)).toBe("normal");
    expect(serviceUrgency(3 * 60_000)).toBe("warning");
    expect(serviceUrgency(7 * 60_000)).toBe("critical");
    expect(serviceUrgency(60_000, { warningMinutes: 1, criticalMinutes: 2 })).toBe("warning");
  });

  it("restoran günü saat dilimine göre (UTC günü değil; yaz saati geçişi dahil)", () => {
    // İstanbul (UTC+3): 22:30Z = yerel 01:30 (12 Ekim) → gün 11 Ekim 21:00Z … 12 Ekim 21:00Z
    const ist = zonedDayBounds("Europe/Istanbul", new Date("2026-10-11T22:30:00Z"));
    expect([ist.start.toISOString(), ist.end.toISOString()]).toEqual(["2026-10-11T21:00:00.000Z", "2026-10-12T21:00:00.000Z"]);
    // Berlin, 25 Ekim 2026 yaz saati bitişi: gün 25 saat
    const ber = zonedDayBounds("Europe/Berlin", new Date("2026-10-25T12:00:00Z"));
    expect([ber.start.toISOString(), ber.end.toISOString()]).toEqual(["2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"]);
    const utc = zonedDayBounds("UTC", new Date("2026-10-11T23:59:59Z"));
    expect(utc.start.toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });
});

describe("not ve görünen ad", () => {
  it("özel not düz metin: kontrol / yön işaretleri atılır, boşluk sadeleşir, uzunluk sınırlanır; HTML yorumlanmaz", () => {
    expect(sanitizeNote("  Çocuk‮   sandalyesi\u0000 lütfen  ", SERVICE_NOTE_MAX)).toBe("Çocuk sandalyesi lütfen");
    expect(sanitizeNote("<b>kalın</b>", SERVICE_NOTE_MAX)).toBe("<b>kalın</b>"); // metin olarak saklanır, React kaçışlar
    expect(sanitizeNote("x".repeat(400), SERVICE_NOTE_MAX)?.length).toBe(SERVICE_NOTE_MAX);
    expect(sanitizeNote("   ", SERVICE_NOTE_MAX)).toBeNull();
  });

  it("personel adı: ad + soyad baş harfi; e-posta / tam soyad yok", () => {
    expect(staffDisplayName("Merve", "Kaya")).toBe("Merve K.");
    expect(staffDisplayName("Ali Rıza", "işık")).toBe("Ali İ.");
    expect(staffDisplayName("", "")).toBe("Personel");
  });
});

describe("olaylar", () => {
  it("servis olay tipleri sürümlü zarfta kabul edilir", () => {
    expect(SERVICE_EVENT_BY_STATUS).toEqual({ OPEN: "SERVICE_REQUEST_CREATED", ACKNOWLEDGED: "SERVICE_REQUEST_ACKNOWLEDGED", COMPLETED: "SERVICE_REQUEST_COMPLETED", CANCELLED: "SERVICE_REQUEST_CANCELLED" });
    expect(parseEnvelope(JSON.stringify({ version: 1, occurredAt: "x", type: "SERVICE_REQUEST_CREATED", data: { kind: "BILL", status: "OPEN" } }))?.type).toBe("SERVICE_REQUEST_CREATED");
  });

  it("personel kanalı talep kimliği + tip + durum; masa kanalı yalnızca tip + durum (kimlik / ad / not yok); kiracılar izole", () => {
    const bus = getRealtimeProvider();
    const staff = vi.fn();
    const other = vi.fn();
    const table = vi.fn();
    const offs = [bus.subscribe(tenantOrdersChannel("tA"), staff), bus.subscribe(tenantOrdersChannel("tB"), other), bus.subscribe(tableChannel("table1"), table)];
    publishServiceRequest({ tenantId: "tA", tableId: "table1", requestId: "req1", kind: "BILL" }, "ACKNOWLEDGED");
    expect(staff.mock.calls[0]![0]).toMatchObject({ type: "SERVICE_REQUEST_ACKNOWLEDGED", data: { requestId: "req1", kind: "BILL", status: "ACKNOWLEDGED" } });
    expect(table.mock.calls[0]![0].data).toEqual({ kind: "BILL", status: "ACKNOWLEDGED" });
    expect(other).not.toHaveBeenCalled();
    offs.forEach((off) => off());
  });
});

describe("müşteri metinleri", () => {
  it("dört dil, tüm tipler, durumlar ve hatalar; ödeme ima edilmez", () => {
    for (const l of ["tr", "en", "de", "ar"]) {
      const s = serviceStrings(l);
      for (const t of SERVICE_REQUEST_TYPES) expect(s.types[t] && s.confirm[t] && s.confirmAction[t] && s.sent[t] && s.alreadySent[t]).toBeTruthy();
      for (const st of ["OPEN", "ACKNOWLEDGED", "COMPLETED", "CANCELLED"] as const) expect(s.status(st, "Merve K.").length).toBeGreaterThan(3);
      expect(s.errorGeneric && s.errorContext && s.errorRateLimited && s.reconnecting).toBeTruthy();
      expect(`${s.sent.BILL} ${s.confirm.BILL}`).not.toMatch(/ödendi|paid|bezahlt|تم الدفع/i);
    }
    const tr = serviceStrings("tr");
    expect(tr.sent.BILL).toBe("Hesap talebiniz iletildi.");
    expect(tr.alreadySent.BILL).toBe("Hesap talebiniz zaten iletildi.");
    expect(tr.status("OPEN", null)).toBe("Talebiniz personele iletildi.");
    expect(tr.status("ACKNOWLEDGED", "Merve")).toBe("Merve talebinizle ilgileniyor.");
    expect(tr.status("COMPLETED", "Merve")).toBe("Talebiniz tamamlandı.");
    expect(tr.errorGeneric).toBe("Talebiniz gönderilemedi. Lütfen tekrar deneyin.");
    expect(serviceStrings("ar").types.WAITER).toMatch(/[؀-ۿ]/);
    expect(serviceStrings("xx").title).toBe(tr.title);
  });
});
