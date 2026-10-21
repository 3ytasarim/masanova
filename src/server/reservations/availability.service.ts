import "server-only";
import { blackoutHit, candidateAssignments, daySlots, maxSeatable, occupancy } from "@/lib/reservations/availability";
import { policyViolation } from "@/lib/reservations/rules";
import { addDays, isValidDate, localParts, weekdayOf } from "@/lib/reservations/time";
import { getPolicy, loadBlackouts, loadBranchContext, loadBusy } from "@/server/reservations/context";
import { checkFeature } from "@/server/billing/entitlements";

/**
 * Public uygunluk: yalnızca GERÇEKTEN masa bulunan saatler döner (boş 15 dk ızgarası gösterilmez). Bilgilendiricidir —
 * nihai karar createReservation'ın kilitli yeniden hesabıdır. Önbellek YOK (doğruluk > önbellek): gün başına tek doluluk
 * + tek kapalı-dönem sorgusu, sonra bellekte hesap.
 */
export type SlotView = { label: string; startsAt: string };
export type AvailabilityResult =
  | { kind: "ok"; slots: SlotView[]; branchName: string }
  | { kind: "disabled" | "invalid" | "closed_day" | "out_of_range" | "party_too_small" }
  | { kind: "party_too_large"; maxOnline: number };

export async function dayAvailability(tenantId: string, input: { branchId: string; date: string; partySize: number; channel: "public" | "staff"; now?: Date }): Promise<AvailabilityResult> {
  const now = input.now ?? new Date();
  const policy = await getPolicy(tenantId);
  if (!policy.enabled || (input.channel === "public" && !policy.publicBookingEnabled)) return { kind: "disabled" };
  if (!(await checkFeature(tenantId, "reservations")).allowed) return { kind: "disabled" };
  if (!isValidDate(input.date) || !Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 100) return { kind: "invalid" };
  const ctx = await loadBranchContext(tenantId, input.branchId);
  if (!ctx) return { kind: "invalid" };
  if (input.partySize < policy.minPartySize) return { kind: "party_too_small" };
  const seatable = maxSeatable(ctx.tables, ctx.combinations);
  if ((input.channel === "public" && input.partySize > policy.maxPartySize) || input.partySize > seatable) return { kind: "party_too_large", maxOnline: Math.min(policy.maxPartySize, seatable) };

  const today = localParts(now, ctx.branch.timeZone).date;
  if (input.date < today || input.date > addDays(today, policy.maxAdvanceDays)) return { kind: "out_of_range" };
  const hours = ctx.hoursByWeekday.get(weekdayOf(input.date)) ?? [];
  if (!hours.length) return { kind: "closed_day" };

  const slots = daySlots({ date: input.date, timeZone: ctx.branch.timeZone, hours, durationMinutes: policy.defaultDurationMinutes, slotIntervalMinutes: policy.slotIntervalMinutes }).filter(
    (s) => !policyViolation(policy, { startsAt: s.startsAt, partySize: input.partySize, now, channel: input.channel }),
  );
  if (!slots.length) return { kind: "ok", slots: [], branchName: ctx.branch.name };
  const window = { start: slots[0]!.startsAt.getTime(), end: slots[slots.length - 1]!.startsAt.getTime() + (policy.defaultDurationMinutes + policy.bufferMinutes) * 60_000 };
  const [busy, blackouts] = await Promise.all([loadBusy(tenantId, input.branchId, window), loadBlackouts(tenantId, input.branchId, window)]);
  const available = slots.filter((s) => {
    const block = occupancy(s.startsAt, policy.defaultDurationMinutes, policy.bufferMinutes);
    if (blackoutHit({ start: block.start, end: block.start + policy.defaultDurationMinutes * 60_000 }, blackouts)) return false;
    return candidateAssignments({ tables: ctx.tables, combinations: ctx.combinations, busy, block, partySize: input.partySize, preferredAreaId: null }).length > 0;
  });
  return { kind: "ok", slots: available.map((s) => ({ label: s.label, startsAt: s.startsAt.toISOString() })), branchName: ctx.branch.name };
}
