/**
 * İstasyon yönlendirmesi (saf). Sipariş kabul edilirken her kalem için:
 *   1) ürünün bu şubedeki AKTİF istasyon atamaları (birden fazla olabilir)
 *   2) yoksa şubenin varsayılan istasyonu (aktifse)
 *   3) o da yoksa → yönlendirilemedi (sipariş kabul edilmez, işletmeye açık uyarı)
 * Ekstralar ayrı fiş oluşturmaz; kalemin içinde gösterilir. Kalem asla sessizce kaybolmaz.
 */
export type RoutingStation = { id: string; name: string; type: string; active: boolean };
export type RoutableItem = { id: string; productId: string | null; name: string };

export type RoutingPlan = {
  tickets: { station: RoutingStation; itemIds: string[] }[];
  unrouted: RoutableItem[];
};

export function planTicketRouting(input: {
  items: readonly RoutableItem[];
  /** productId → bu şubede atanmış istasyonlar */
  assignments: ReadonlyMap<string, readonly RoutingStation[]>;
  defaultStation: RoutingStation | null;
}): RoutingPlan {
  const byStation = new Map<string, { station: RoutingStation; itemIds: string[] }>();
  const unrouted: RoutableItem[] = [];
  const fallback = input.defaultStation?.active ? input.defaultStation : null;
  for (const item of input.items) {
    const assigned = (item.productId ? (input.assignments.get(item.productId) ?? []) : []).filter((s) => s.active);
    const targets = assigned.length ? assigned : fallback ? [fallback] : [];
    if (!targets.length) {
      unrouted.push(item);
      continue;
    }
    for (const station of targets) {
      const entry = byStation.get(station.id) ?? { station, itemIds: [] };
      entry.itemIds.push(item.id);
      byStation.set(station.id, entry);
    }
  }
  return { tickets: [...byStation.values()], unrouted };
}

// ─── KDS aciliyeti ──────────────────────────────────────────────────────────

export const DEFAULT_URGENCY = { warningMinutes: 10, criticalMinutes: 20 } as const;
export type Urgency = "normal" | "warning" | "critical";

export function urgencyFor(elapsedMs: number, thresholds: { warningMinutes: number; criticalMinutes: number } = DEFAULT_URGENCY): Urgency {
  const minutes = elapsedMs / 60_000;
  if (minutes >= thresholds.criticalMinutes) return "critical";
  if (minutes >= thresholds.warningMinutes) return "warning";
  return "normal";
}

/** "03:42", "12:18", 1 saati aşınca "1:02:05". */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
