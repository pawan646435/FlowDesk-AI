import { getVerifiedSession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getTicketStats, getRecentTickets } from "@/services/ticket.service";
import { getSLADashboardStats } from "@/services/sla.service";
import { getRecentActivities } from "@/services/activity.service";
import {
  getOrganizationMembersWithOpenTicketCount,
  getOrganizationWebhookConfig,
  getWhatsAppNumberMapping,
  getPendingInvitesForUser,
} from "@/services/organization.service";
import { Ticket, Clock, CheckCircle, ListTodo, ArrowUpRight, Plus, ShieldAlert, Smartphone, Users, Crown, Webhook, CheckCircle2, XCircle, Mail } from "lucide-react";

export default async function DashboardPage() {
  // JOIN_REQUEST_DESIGN.md §3.3 open decision #2, resolved: centralize the
  // unauthenticated-vs-orgless redirect distinction here rather than in /login. requireOrg:
  // false only distinguishes "no session at all" (still redirects to /login, inside the
  // helper) from "authenticated, no org" (returned here, redirected to /onboarding below) —
  // once organizationId is confirmed present, the second call re-applies the full
  // requireOrg: true staleness guarantee every other protected page already relies on.
  const initialSession = await getVerifiedSession({ onStale: "redirect", requireOrg: false });
  if (!initialSession.user.organizationId) {
    redirect("/onboarding");
  }

  const session = await getVerifiedSession();

  const organizationId = session.user.organizationId;
  const isOwner = session.user.role === "OWNER";

  // Fetch data in parallel for optimal scaling. The OWNER-only widgets' data is fetched
  // conditionally (Promise.resolve(null) placeholders otherwise) rather than always
  // fetching and just not rendering — no reason to run the extra groupBy/lookups on
  // every MEMBER dashboard load. Reuses the exact session.user.role === "OWNER" pattern
  // already established on /settings — no new gating mechanism.
  //
  // getSLADashboardStats is deliberately NOT in this Promise.all. Perf audit (measured
  // against the dev DB, repeated runs): it consistently takes 2-3x longer than every other
  // query here (an existing over-fetch — pulls every responded ticket's full activities
  // relation to compute one average — flagged separately, not fixed here). Every other
  // query below lands in the same ~600ms-2s band, so bundling it in would make the whole
  // page wait on the one outlier. It's passed as a still-pending Promise into a Suspense
  // boundary instead, so the page shell and every other section render as soon as they're
  // ready and only the SLA metrics card streams in after.
  const slaStatsPromise = getSLADashboardStats(organizationId);

  const [stats, activities, recentTickets, members, webhookConfig, whatsAppMapping, pendingInvites] = await Promise.all([
    getTicketStats(organizationId),
    getRecentActivities(organizationId, 5),
    getRecentTickets(organizationId, 5),
    isOwner ? getOrganizationMembersWithOpenTicketCount(organizationId) : Promise.resolve(null),
    isOwner ? getOrganizationWebhookConfig(organizationId) : Promise.resolve(null),
    isOwner ? getWhatsAppNumberMapping(organizationId) : Promise.resolve(null),
    // TEAM_REMOVAL_DESIGN.md §3.4 — small discoverability banner, /settings stays the
    // primary location (full list, actions). This only needs a count, not full invite
    // details, to decide whether to render.
    session.user.email ? getPendingInvitesForUser(session.user.email) : Promise.resolve([]),
  ]);

  const otherOrgPendingInviteCount = pendingInvites.filter(
    (inv) => inv.organizationId !== organizationId
  ).length;

  const statsCards = [
    {
      name: "Total Tickets",
      value: stats.total,
      icon: Ticket,
      description: "All tickets raised",
      color: "from-blue-600/20 to-indigo-600/20 border-blue-500/20 text-blue-400",
    },
    {
      name: "Open Tickets",
      value: stats.open + stats.inProgress,
      icon: ListTodo,
      description: "Active requests",
      color: "from-amber-600/20 to-orange-600/20 border-amber-500/20 text-amber-400 hover:scale-[1.02] transition-transform duration-200 cursor-pointer shadow-lg hover:border-amber-500/40",
      href: "/tickets/queue",
    },
    {
      name: "Resolved Tickets",
      value: stats.resolved,
      icon: CheckCircle,
      description: "Successfully closed",
      color: "from-emerald-600/20 to-teal-600/20 border-emerald-500/20 text-emerald-400",
    },
    {
      name: "SLA Breached Tickets",
      value: stats.slaBreachedCount,
      icon: ShieldAlert,
      description: "Requires immediate response",
      color: "from-rose-600/20 to-red-600/20 border-rose-500/20 text-rose-400",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {session.user.name}. Here is your support overview.
          </p>
        </div>
        <div>
          <Link
            href="/tickets"
            className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-all shadow-md glow-purple cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Manage & Create Tickets
          </Link>
        </div>
      </div>

      {/* TEAM_REMOVAL_DESIGN.md §3.4 — small discoverability nudge; the full list and
          accept/switch actions live on /settings, this just points there. */}
      {otherOrgPendingInviteCount > 0 && (
        <Link
          href="/settings"
          className="flex items-center justify-between rounded-2xl border border-primary/30 glass p-4 hover:border-primary/50 transition-all cursor-pointer glow-purple"
        >
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-primary shrink-0" />
            <p className="text-sm font-medium text-foreground">
              You have {otherOrgPendingInviteCount} pending {otherOrgPendingInviteCount === 1 ? "invite" : "invites"} to {otherOrgPendingInviteCount === 1 ? "another organization" : "other organizations"}.
            </p>
          </div>
          <span className="text-xs font-semibold text-primary flex items-center gap-1 shrink-0">
            View in Settings
            <ArrowUpRight className="h-3 w-3" />
          </span>
        </Link>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
        {statsCards.map((card) => {
          const Icon = card.icon;
          const cardContent = (
            <div
              className={`relative overflow-hidden rounded-2xl border p-6 bg-gradient-to-br ${card.color} glass h-full`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium opacity-80 text-foreground">{card.name}</p>
                  <h4 className="text-4xl font-extrabold tracking-tight mt-2 text-foreground">
                    {card.value}
                  </h4>
                </div>
                <div className="rounded-xl p-3 bg-foreground/5">
                  <Icon className="h-6 w-6" />
                </div>
              </div>
              <p className="text-xs opacity-60 mt-4 text-foreground">{card.description}</p>
            </div>
          );

          if (card.href) {
            return (
              <Link key={card.name} href={card.href} className="block h-full">
                {cardContent}
              </Link>
            );
          }

          return (
            <div key={card.name} className="h-full">
              {cardContent}
            </div>
          );
        })}
      </div>

      {/* SLA & Performance Overview — streamed in separately via Suspense. Perf audit
          measurement: getSLADashboardStats consistently takes 2-3x longer than every other
          dashboard query, so this card's own loading skeleton renders immediately while it
          resolves, instead of holding the entire page (already-ready stat cards, recent
          tickets, activity feed, OWNER widgets) back until this one query finishes. */}
      <Suspense fallback={<SLAMetricsSkeleton />}>
        <SLAMetricsSection slaStatsPromise={slaStatsPromise} />
      </Suspense>

      {/* AI Analytics Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Ticket Categories breakdown */}
        <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
          <h3 className="text-lg font-semibold">Tickets by Category</h3>
          <div className="grid grid-cols-1 gap-3">
            {stats.categories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No categories analyzed yet.</p>
            ) : (
              stats.categories.map((c) => (
                <div
                  key={c.category}
                  className="flex items-center justify-between border-b border-border/20 pb-2.5 last:border-b-0 last:pb-0"
                >
                  <span className="text-sm font-semibold capitalize text-muted-foreground">
                    {c.category.toLowerCase()}
                  </span>
                  <span className="rounded-xl bg-primary/10 text-primary border border-primary/20 px-3 py-1 text-xs font-bold">
                    {c.count} {c.count === 1 ? "ticket" : "tickets"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* AI Sentiment Distribution */}
        <div className="rounded-2xl border border-border/40 glass p-6 space-y-6">
          {(() => {
            const negativeCount = stats.sentiments.find((s) => s.sentiment === "NEGATIVE")?.count || 0;
            const negativeRatio = stats.total > 0 ? (negativeCount / stats.total) * 100 : 0;

            return (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">AI Sentiment Analytics</h3>
                  {negativeCount > 0 ? (
                    <span className="rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-1 text-xs font-bold flex items-center gap-1.5 animate-pulse">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                      {negativeCount} Negative
                    </span>
                  ) : (
                    <span className="rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 text-xs font-bold">
                      0 Negative
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  {stats.sentiments.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No sentiments processed yet.</p>
                  ) : (
                    stats.sentiments.map((s) => {
                      const percentage = Math.round((s.count / stats.total) * 100) || 0;
                      const color =
                        s.sentiment === "POSITIVE"
                          ? "bg-emerald-500"
                          : s.sentiment === "NEGATIVE"
                          ? "bg-rose-500"
                          : "bg-amber-500";
                      return (
                        <div key={s.sentiment} className="space-y-1.5">
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold capitalize text-muted-foreground">
                              {s.sentiment.toLowerCase()}
                            </span>
                            <span className="text-xs font-bold text-foreground">
                              {s.count} ({percentage}%)
                            </span>
                          </div>
                          <div className="h-2.5 w-full rounded-full bg-secondary/60 overflow-hidden border border-border/10">
                            <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Trend Analysis Alert Box */}
                <div className={`rounded-xl border p-4 text-xs font-medium space-y-1 ${
                  negativeRatio > 30 
                    ? "bg-red-500/10 border-red-500/20 text-red-400"
                    : negativeRatio > 10
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                }`}>
                  <span className="font-bold uppercase tracking-wider block mb-0.5 text-xxs opacity-90">Trend Analysis</span>
                  <p className="leading-relaxed opacity-95">
                    {negativeRatio > 30 
                      ? "🚨 HIGH RISK ALERT: More than 30% of active interactions are negative. Automated escalation webhooks are notifying Customer Success teams."
                      : negativeRatio > 10
                      ? "⚠️ WARNING TREND: Moderate levels of negative sentiment detected. CS teams should monitor the queue for escalations."
                      : "💚 HEALTHY TREND: Support satisfaction levels are positive. Negative sentiment is within standard operational thresholds (<10%)."}
                  </p>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* WhatsApp Channel Analytics */}
      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-emerald-450" />
              WhatsApp Support Channel Analytics
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live statistics from the WhatsApp conversational support assistant integration.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/tickets/whatsapp-history"
              className="text-xs font-semibold rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1.5 transition-all cursor-pointer"
            >
              Open Inbox
            </Link>
            <Link
              href="/tickets/whatsapp-simulator"
              className="text-xs font-semibold rounded-lg bg-zinc-850 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 transition-all cursor-pointer"
            >
              Open Simulator
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border/25 bg-gradient-to-br from-emerald-600/5 to-teal-600/5 p-4 space-y-1">
            <span className="text-xs text-muted-foreground block font-medium">WhatsApp Sessions</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{stats.whatsAppConversationCount}</span>
              <span className="text-[10px] text-emerald-500 font-medium">Active / Resolved</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/25 bg-gradient-to-br from-blue-600/5 to-indigo-600/5 p-4 space-y-1">
            <span className="text-xs text-muted-foreground block font-medium">Tickets via WhatsApp</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{stats.whatsAppTicketsCount}</span>
              <span className="text-[10px] text-blue-400 font-medium">Source = WHATSAPP</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/25 bg-gradient-to-br from-zinc-650/5 to-zinc-700/5 p-4 space-y-1">
            <span className="text-xs text-muted-foreground block font-medium">Tickets via Web Portal</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{stats.webTicketsCount}</span>
              <span className="text-[10px] text-zinc-400 font-medium">Source = WEB</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Recent Tickets & Activity Feed */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Recent Tickets */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Recent Tickets</h3>
            <Link
              href="/tickets"
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              View all
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="rounded-2xl border border-border/40 glass overflow-hidden">
            {recentTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <Ticket className="h-10 w-10 text-muted-foreground mb-4 opacity-40" />
                <h4 className="text-lg font-semibold">No tickets found</h4>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Create your first support ticket to see it appear here on your dashboard feed.
                </p>
                <Link
                  href="/tickets"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-all cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Create Ticket
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {recentTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/tickets/${ticket.id}`}
                    className="block p-5 hover:bg-muted/30 transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-base truncate text-foreground group-hover:text-primary">
                            {ticket.title}
                          </h4>
                          {ticket.priority === "HIGH" && (
                            <span className="inline-flex items-center rounded-md bg-rose-500/10 px-1.5 py-0.5 text-xxs font-semibold text-rose-400 border border-rose-500/20">
                              HIGH
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {ticket.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            ticket.status === "OPEN"
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : ticket.status === "IN_PROGRESS"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          }`}
                        >
                          {ticket.status.replace("_", " ")}
                        </span>
                        <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(ticket.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Activity Timeline</h3>

          <div className="rounded-2xl border border-border/40 glass p-6 space-y-6">
            {activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-8 w-8 text-muted-foreground mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">
                  No activity logged yet. Your actions will be tracked chronologically.
                </p>
              </div>
            ) : (
              <div className="flow-root">
                <ul className="-mb-8">
                  {activities.map((activity, activityIdx) => (
                    <li key={activity.id}>
                      <div className="relative pb-8">
                        {activityIdx !== activities.length - 1 ? (
                          <span
                            className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-border/40"
                            aria-hidden="true"
                          />
                        ) : null}
                        <div className="relative flex space-x-3">
                          <div>
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20">
                              <Clock className="h-4 w-4" />
                            </span>
                          </div>
                          <div className="flex-1 min-w-0 pt-1.5">
                            <p className="text-sm text-foreground font-medium">
                              {activity.action}
                            </p>
                            <div className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
                              <Link
                                href={`/tickets/${activity.ticketId}`}
                                className="hover:underline text-primary/80 font-medium"
                              >
                                View Ticket
                              </Link>
                              <span>
                                {new Date(activity.createdAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ORG_ONBOARDING_DESIGN.md §2.3 — OWNER-only widgets, additional to the shared
          org-wide dashboard above. Everyone (OWNER and MEMBER) already sees the same
          ticket data via the sections above; these two sections are extra, not a
          different scope of ticket visibility. */}
      {isOwner && members && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Team Overview */}
          <div className="rounded-2xl border border-border/40 glass overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-border/40">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Team Overview</h3>
            </div>
            <div className="divide-y divide-border/30">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">
                      {member.name || "Unnamed"}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="rounded-xl bg-primary/10 text-primary border border-primary/20 px-3 py-1 text-xs font-bold">
                      {member.openTicketCount} open
                    </span>
                    {member.role === "OWNER" && (
                      <span className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Crown className="h-3 w-3" />
                        Owner
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Integration Health */}
          <div className="rounded-2xl border border-border/40 glass overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-border/40">
              <Webhook className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Integration Health</h3>
            </div>
            <div className="divide-y divide-border/30">
              {[
                { label: "New Ticket webhook", configured: !!webhookConfig?.newTicketUrl },
                { label: "Escalation webhook", configured: !!webhookConfig?.escalationUrl },
                { label: "Negative Sentiment webhook", configured: !!webhookConfig?.negativeSentimentUrl },
                { label: "Resolution webhook", configured: !!webhookConfig?.resolutionUrl },
                { label: "SLA Breach webhook", configured: !!webhookConfig?.slaBreachUrl },
                { label: "WhatsApp number", configured: !!whatsAppMapping },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between px-6 py-3.5"
                >
                  <span className="text-sm text-foreground">{item.label}</span>
                  {item.configured ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Configured
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <XCircle className="h-4 w-4" />
                      Not configured
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-border/40">
              <Link
                href="/settings"
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                Manage in Settings
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Split out as its own async Server Component so it can sit inside a Suspense boundary —
// awaiting slaStatsPromise here is what lets Next.js render SLAMetricsSkeleton immediately
// and stream this section in once getSLADashboardStats actually resolves.
async function SLAMetricsSection({
  slaStatsPromise,
}: {
  slaStatsPromise: ReturnType<typeof getSLADashboardStats>;
}) {
  const slaStats = await slaStatsPromise;

  return (
    <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Clock className="h-5 w-5 text-indigo-400" />
        SLA & Performance Metrics
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border/20 bg-zinc-950/20 p-4">
          <span className="text-xs text-muted-foreground font-semibold block">Active SLAs</span>
          <span className="text-2xl font-extrabold text-foreground mt-1.5 block">
            {slaStats.activeSlas || 0}
          </span>
          <span className="text-[10px] text-muted-foreground block mt-1">Monitored active items</span>
        </div>

        <div className="rounded-xl border border-border/20 bg-zinc-950/20 p-4">
          <span className="text-xs text-muted-foreground font-semibold block">Breached SLAs</span>
          <span className={`text-2xl font-extrabold mt-1.5 block ${
            slaStats.breachedSlas > 0 ? "text-rose-400" : "text-foreground"
          }`}>
            {slaStats.breachedSlas || 0}
          </span>
          <span className="text-[10px] text-muted-foreground block mt-1">Exceeded target timeline</span>
        </div>

        <div className="rounded-xl border border-border/20 bg-zinc-950/20 p-4">
          <span className="text-xs text-muted-foreground font-semibold block">SLA Compliance Rate</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1.5 block">
            {slaStats.complianceRate ?? 100}%
          </span>
          <span className="text-[10px] text-muted-foreground block mt-1">Target resolution met</span>
        </div>

        <div className="rounded-xl border border-border/20 bg-zinc-950/20 p-4">
          <span className="text-xs text-muted-foreground font-semibold block">Avg Agent Response</span>
          <span className="text-2xl font-extrabold text-foreground mt-1.5 block">
            {slaStats.averageResponseTime || 0} min
          </span>
          <span className="text-[10px] text-muted-foreground block mt-1">From ticket creation</span>
        </div>
      </div>
    </div>
  );
}

// Matches SLAMetricsSection's layout exactly (same 4-column grid, same card shape) so
// there's no layout shift when the real data streams in — just the numbers appearing.
function SLAMetricsSkeleton() {
  return (
    <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Clock className="h-5 w-5 text-indigo-400" />
        SLA & Performance Metrics
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {["Active SLAs", "Breached SLAs", "SLA Compliance Rate", "Avg Agent Response"].map((label) => (
          <div key={label} className="rounded-xl border border-border/20 bg-zinc-950/20 p-4">
            <span className="text-xs text-muted-foreground font-semibold block">{label}</span>
            <span className="mt-1.5 block h-8 w-16 animate-pulse rounded bg-foreground/10" />
            <span className="text-[10px] text-muted-foreground block mt-1 opacity-50">Loading…</span>
          </div>
        ))}
      </div>
    </div>
  );
}
