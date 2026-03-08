export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
          <div className="h-9 w-32 bg-zinc-800 rounded animate-pulse" />
        </div>

        {/* KPI cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
              <div className="h-4 w-20 bg-zinc-800 rounded animate-pulse" />
              <div className="h-8 w-16 bg-zinc-800 rounded animate-pulse" />
              <div className="h-3 w-24 bg-zinc-800 rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="h-6 w-40 bg-zinc-800 rounded animate-pulse mb-4" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-24 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-16 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 flex-1 bg-zinc-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
