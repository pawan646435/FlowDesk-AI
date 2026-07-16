// Pure static skeleton, no data fetching. Shape mirrors tickets/queue/page.tsx: header,
// 2 KPI cards, two sectioned lists of queue-card rows.
function QueueCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/40 glass p-5 sm:p-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="h-5 w-16 rounded-md bg-foreground/10" />
        <div className="h-5 w-20 rounded-md bg-foreground/5" />
        <div className="h-5 w-16 rounded-full bg-foreground/5" />
      </div>
      <div className="h-5 w-2/3 rounded bg-foreground/10" />
      <div className="h-4 w-full rounded bg-foreground/5" />
      <div className="flex items-center gap-4">
        <div className="h-3 w-32 rounded bg-foreground/5" />
        <div className="h-3 w-40 rounded bg-foreground/5" />
      </div>
    </div>
  );
}

export default function QueueLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-pulse">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-4 w-48 rounded bg-foreground/10" />
          <div className="h-8 w-64 rounded-lg bg-foreground/10" />
          <div className="h-4 w-96 rounded bg-foreground/5" />
        </div>
        <div className="h-10 w-44 rounded-xl bg-foreground/10" />
      </div>

      {/* KPI Section */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/40 glass p-6 flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-3 w-40 rounded bg-foreground/10" />
              <div className="h-8 w-12 rounded bg-foreground/10" />
            </div>
            <div className="h-12 w-12 rounded-xl bg-foreground/5" />
          </div>
        ))}
      </div>

      {/* Section A */}
      <div className="space-y-4">
        <div className="h-5 w-72 rounded bg-foreground/10" />
        <div className="grid grid-cols-1 gap-4">
          <QueueCardSkeleton />
          <QueueCardSkeleton />
        </div>
      </div>

      {/* Section B */}
      <div className="space-y-4 pt-4">
        <div className="h-5 w-72 rounded bg-foreground/10" />
        <div className="grid grid-cols-1 gap-4">
          <QueueCardSkeleton />
          <QueueCardSkeleton />
        </div>
      </div>
    </div>
  );
}
