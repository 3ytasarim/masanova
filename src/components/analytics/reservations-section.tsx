import { minuteLabel } from "@/lib/reservations/time";
import { RESERVATION_STATUS_LABELS } from "@/lib/reservations/status";
import { StatCard } from "@/components/ui/stat-card";

type Metrics = {
  total: number;
  byStatus: Record<"PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW", number>;
  seated: number;
  walkIns: number;
  guests: number;
  avgParty: number | null;
  byHour: number[];
};

/**
 * Analitik › Masalar altındaki rezervasyon özeti (Sprint 17). Yalnızca toplamlar — kişisel veri yok; İşletme
 * Danışmanı'na bu sprintte bağlanmaz. Saat dağılımı = rezervasyon başlangıç saatine göre beklenen kişi (iptaller hariç).
 */
export function ReservationsAnalytics({ data }: { data: Metrics }) {
  const max = Math.max(1, ...data.byHour);
  const hours = data.byHour.map((v, h) => ({ h, v })).filter((x) => x.v > 0);
  const pct = (n: number) => (data.total ? `%${Math.round((n / data.total) * 100)}` : "—");
  return (
    <section aria-labelledby="res-analytics" className="grid gap-4" data-testid="analytics-reservations">
      <h2 id="res-analytics" className="text-base font-semibold text-fg">
        Rezervasyonlar
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Rezervasyon" value={data.total} hint={`${data.walkIns} walk-in`} />
        <StatCard label="Masaya alınan" value={data.seated} hint={pct(data.seated)} />
        <StatCard label={RESERVATION_STATUS_LABELS.CANCELLED} value={data.byStatus.CANCELLED} hint={pct(data.byStatus.CANCELLED)} />
        <StatCard label={RESERVATION_STATUS_LABELS.NO_SHOW} value={data.byStatus.NO_SHOW} hint={pct(data.byStatus.NO_SHOW)} />
        <StatCard label="Ort. kişi" value={data.avgParty === null ? "—" : data.avgParty.toFixed(1)} hint={`${data.guests} kişi`} />
      </div>
      {hours.length ? (
        <div className="rounded-lg border border-border bg-bg p-4">
          <p className="text-sm font-medium text-fg">Saate göre beklenen kişi</p>
          <ul className="mt-3 grid gap-1.5">
            {hours.map(({ h, v }) => (
              <li key={h} className="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-2 text-xs">
                <span className="tabular-nums text-fg-subtle">{minuteLabel(h * 60)}</span>
                <span className="h-2.5 rounded-full bg-accent/70" style={{ width: `${(v / max) * 100}%` }} aria-hidden="true" />
                <span className="text-right tabular-nums text-fg">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-fg-subtle">Bu aralıkta rezervasyon yok.</p>
      )}
    </section>
  );
}
