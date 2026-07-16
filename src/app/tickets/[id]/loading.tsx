// Pure static skeleton, no data fetching. Shape mirrors tickets/[id]/page.tsx: back link,
// ticket header card (badges + title + status control), description block, metadata row,
// activity timeline.
export default function TicketDetailLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-pulse">
      <div className="h-4 w-32 rounded bg-foreground/10" />

      {/* Ticket Header */}
      <div className="rounded-2xl border border-border/40 p-6 sm:p-8 glass space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/20 pb-6">
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-5 w-16 rounded-full bg-foreground/10" />
              <div className="h-5 w-20 rounded-full bg-foreground/5" />
              <div className="h-5 w-20 rounded-full bg-foreground/5" />
            </div>
            <div className="h-8 w-3/4 rounded-lg bg-foreground/10" />
          </div>
          <div className="h-10 w-36 rounded-xl bg-foreground/10" />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-foreground/10" />
          <div className="h-20 w-full rounded-xl bg-foreground/5" />
        </div>

        {/* AI Agent Summary Panel */}
        <div className="rounded-2xl border border-border/20 p-6 space-y-4">
          <div className="h-4 w-56 rounded bg-foreground/10" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-2">
              <div className="h-3 w-24 rounded bg-foreground/10" />
              <div className="h-12 w-full rounded bg-foreground/5" />
            </div>
            <div className="space-y-3">
              <div className="h-3 w-32 rounded bg-foreground/10" />
              <div className="h-6 w-24 rounded-xl bg-foreground/5" />
            </div>
          </div>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border/20 pt-6">
          <div className="h-4 w-48 rounded bg-foreground/5" />
          <div className="h-4 w-48 rounded bg-foreground/5" />
        </div>
      </div>

      {/* Ticket Activity Timeline */}
      <div className="space-y-4">
        <div className="h-6 w-40 rounded bg-foreground/10" />
        <div className="rounded-2xl border border-border/40 p-6 glass space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-foreground/10 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 rounded bg-foreground/10" />
              </div>
              <div className="h-3 w-28 rounded bg-foreground/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
