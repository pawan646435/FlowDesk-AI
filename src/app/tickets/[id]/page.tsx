import { auth } from "@/auth";
import { getTicketById } from "@/services/ticket.service";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { StatusDropdown } from "@/components/status-dropdown";
import { ArrowLeft, Clock, Calendar, Sparkles } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TicketDetailsPage({ params }: PageProps) {
  const session = await auth();

  if (!session || !session.user?.id) {
    redirect("/login");
  }

  const resolvedParams = await params;
  const ticket = await getTicketById(session.user.id, resolvedParams.id);

  if (!ticket) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Back to Tickets Link */}
      <div>
        <Link
          href="/tickets"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tickets
        </Link>
      </div>

      {/* Ticket Header */}
      <div className="rounded-2xl border border-border/40 p-6 sm:p-8 glass space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/20 pb-6">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
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
              {ticket.userPriority && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground border border-border/40">
                  User: {ticket.userPriority}
                </span>
              )}
              {ticket.aiPriority && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide border shadow-sm ${
                    ticket.aiPriority === "CRITICAL"
                      ? "bg-red-500 text-white animate-pulse"
                      : ticket.aiPriority === "HIGH"
                      ? "bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse"
                      : ticket.aiPriority === "MEDIUM"
                      ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                      : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                  }`}
                >
                  AI: {ticket.aiPriority}
                </span>
              )}
              {ticket.category && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground border border-border/40">
                  {ticket.category.toLowerCase()}
                </span>
              )}
              {ticket.source && (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                  ticket.source === "WHATSAPP"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                }`}>
                  Source: {ticket.source.toLowerCase()}
                </span>
              )}
              <span className="text-xs text-muted-foreground">ID: {ticket.id}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mt-2">
              {ticket.title}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <StatusDropdown ticketId={ticket.id} currentStatus={ticket.status} />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Description
          </h3>
          <p className="text-foreground leading-relaxed whitespace-pre-line bg-muted/20 p-4 rounded-xl border border-border/20">
            {ticket.description}
          </p>
        </div>

        {/* AI Agent Summary Panel */}
        {ticket.aiSummary && (
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-purple-500/5 p-6 space-y-4 relative overflow-hidden glass shadow-lg">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5 animate-pulse" />
              <h3 className="text-sm font-bold uppercase tracking-wider">AI Support-Agent Summary</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
              <div className="md:col-span-2 space-y-4">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brief Summary</span>
                  <p className="text-sm text-foreground leading-relaxed mt-1">{ticket.aiSummary}</p>
                </div>

                {ticket.keyIssues && (
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Key Issues Identified</span>
                    <div className="flex flex-wrap gap-2">
                      {ticket.keyIssues.split(",").map((issue) => (
                        <span key={issue} className="inline-flex items-center rounded-lg bg-foreground/5 border border-border/40 px-2.5 py-1 text-xs font-medium text-foreground">
                          • {issue.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4 border-t md:border-t-0 md:border-l border-border/20 pt-4 md:pt-0 md:pl-6">
                {ticket.recommendedTeam && (
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Recommended Routing Team</span>
                    <span className="inline-flex items-center rounded-xl bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 text-xs font-extrabold uppercase mt-1 shadow-sm">
                      {ticket.recommendedTeam}
                    </span>
                  </div>
                )}

                {ticket.sentiment && (
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Detected Sentiment</span>
                    <span className={`inline-flex items-center rounded-xl px-3 py-1.5 text-xs font-extrabold uppercase mt-1 border shadow-sm ${
                      ticket.sentiment === "NEGATIVE"
                        ? "bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse"
                        : ticket.sentiment === "POSITIVE"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    }`}>
                      {ticket.sentiment}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Suggested Response Panel */}
            {ticket.suggestedReply && (
              <div className="border-t border-border/20 pt-4 mt-2 space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Suggested AI Draft Reply</span>
                <div className="relative rounded-xl bg-background/50 border border-border/20 p-4 text-xs font-mono leading-relaxed select-all">
                  {ticket.suggestedReply}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border/20 pt-6 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Created: {new Date(ticket.createdAt).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Last Updated: {new Date(ticket.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Ticket Activity Timeline */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold">Ticket History</h3>
        <div className="rounded-2xl border border-border/40 p-6 glass space-y-6">
          {ticket.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No historical updates for this ticket.
            </p>
          ) : (
            <div className="flow-root">
              <ul className="-mb-8">
                {ticket.activities.map((activity, activityIdx) => (
                  <li key={activity.id}>
                    <div className="relative pb-8">
                      {activityIdx !== ticket.activities.length - 1 ? (
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
                        <div className="flex-1 min-w-0 pt-1.5 flex justify-between gap-4">
                          <div>
                            <p className="text-sm text-foreground font-medium">
                              {activity.action}
                            </p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                            <span>{new Date(activity.createdAt).toLocaleString()}</span>
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
  );
}
