// Pure static skeleton, no data fetching — Next.js renders this instantly on navigation
// while dashboard/page.tsx's Server Component (session check + data queries) resolves.
// Shape mirrors the real page: header, 4 stat cards, SLA metrics row, two-column AI
// analytics section, recent tickets + activity timeline.
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-pulse">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-48 rounded-lg bg-foreground/10" />
          <div className="h-4 w-72 rounded bg-foreground/5" />
        </div>
        <div className="h-10 w-56 rounded-xl bg-foreground/10" />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/40 glass p-6 h-full space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-4 w-24 rounded bg-foreground/10" />
                <div className="h-8 w-16 rounded bg-foreground/10" />
              </div>
              <div className="h-11 w-11 rounded-xl bg-foreground/5" />
            </div>
            <div className="h-3 w-32 rounded bg-foreground/5" />
          </div>
        ))}
      </div>

      {/* SLA & Performance Overview */}
      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="h-5 w-56 rounded bg-foreground/10" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/20 bg-zinc-950/20 p-4 space-y-2">
              <div className="h-3 w-20 rounded bg-foreground/10" />
              <div className="h-6 w-14 rounded bg-foreground/10" />
              <div className="h-2.5 w-24 rounded bg-foreground/5" />
            </div>
          ))}
        </div>
      </div>

      {/* AI Analytics Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/40 glass p-6 space-y-4">
            <div className="h-5 w-40 rounded bg-foreground/10" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-4 w-full rounded bg-foreground/5" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* WhatsApp Channel Analytics */}
      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="h-5 w-64 rounded bg-foreground/10" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/25 p-4 space-y-2">
              <div className="h-3 w-28 rounded bg-foreground/10" />
              <div className="h-7 w-16 rounded bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>

      {/* Main Grid: Recent Tickets & Activity Feed */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-6 w-36 rounded bg-foreground/10" />
          <div className="rounded-2xl border border-border/40 glass overflow-hidden">
            <div className="divide-y divide-border/30">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-5 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-foreground/10" />
                  <div className="h-3 w-full rounded bg-foreground/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="h-6 w-40 rounded bg-foreground/10" />
          <div className="rounded-2xl border border-border/40 glass p-6 space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-foreground/10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-full rounded bg-foreground/10" />
                  <div className="h-3 w-20 rounded bg-foreground/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
