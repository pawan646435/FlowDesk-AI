// Pure static skeleton, no data fetching. Shape mirrors settings/page.tsx: header,
// org profile card, invite-teammate card, team members list, webhook settings card.
export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-40 rounded-lg bg-foreground/10" />
        <div className="h-4 w-64 rounded bg-foreground/5" />
      </div>

      {/* Org Profile */}
      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="h-5 w-32 rounded bg-foreground/10" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 rounded bg-foreground/10" />
              <div className="h-4 w-28 rounded bg-foreground/5" />
            </div>
          ))}
        </div>
      </div>

      {/* Invite a teammate */}
      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="h-5 w-40 rounded bg-foreground/10" />
        <div className="h-10 w-full rounded-xl bg-foreground/5" />
      </div>

      {/* Team members */}
      <div className="rounded-2xl border border-border/40 glass overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-border/40">
          <div className="h-5 w-32 rounded bg-foreground/10" />
        </div>
        <div className="divide-y divide-border/30">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-6 py-4">
              <div className="space-y-2">
                <div className="h-4 w-32 rounded bg-foreground/10" />
                <div className="h-3 w-44 rounded bg-foreground/5" />
              </div>
              <div className="h-6 w-16 rounded-full bg-foreground/5" />
            </div>
          ))}
        </div>
      </div>

      {/* n8n webhook settings */}
      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="h-5 w-56 rounded bg-foreground/10" />
        <div className="h-3 w-3/4 rounded bg-foreground/5" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 w-full rounded-xl bg-foreground/5" />
          ))}
        </div>
      </div>
    </div>
  );
}
