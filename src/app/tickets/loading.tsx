// Pure static skeleton, no data fetching. Shape mirrors tickets/page.tsx: header with
// action buttons, filter pills, list of ticket rows.
export default function TicketsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-pulse">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-32 rounded-lg bg-foreground/10" />
          <div className="h-4 w-80 rounded bg-foreground/5" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-36 rounded-xl bg-foreground/10" />
          <div className="h-10 w-32 rounded-xl bg-foreground/10" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 border-b border-border/40 pb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-24 rounded-xl bg-foreground/5" />
        ))}
      </div>

      {/* Tickets List */}
      <div className="rounded-2xl border border-border/40 glass overflow-hidden">
        <div className="divide-y divide-border/30">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-48 rounded bg-foreground/10" />
                  <div className="h-5 w-16 rounded-full bg-foreground/5" />
                  <div className="h-5 w-14 rounded-full bg-foreground/5" />
                </div>
                <div className="h-4 w-3/4 rounded bg-foreground/5" />
                <div className="h-3 w-56 rounded bg-foreground/5" />
              </div>
              <div className="h-9 w-24 rounded-xl bg-foreground/10 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
