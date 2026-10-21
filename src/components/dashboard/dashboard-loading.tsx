import { Skeleton } from "@/components/ui/skeleton";
import { StatCardSkeleton } from "@/components/ui/stat-card";

export function DashboardLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Yükleniyor…</span>
      <div className="pb-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-8 w-64 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <Skeleton className="mt-8 h-64 w-full rounded-lg" />
    </div>
  );
}
