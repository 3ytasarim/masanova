import { StatCardSkeleton } from "@/components/ui/stat-card";

/** Analitik yüklenirken iskelet (KPI kartları + grafik alanı). */
export default function AnalyticsLoading() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
