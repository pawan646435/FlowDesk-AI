import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getQueueTickets } from "@/services/ticket.service";
import { ArrowLeft, Inbox, ShieldAlert, Sparkles, User, Tag, Clock, Eye } from "lucide-react";

export default async function QueuePage() {
  const session = await auth();

  if (!session || !session.user?.id) {
    redirect("/login");
  }

  const tickets = await getQueueTickets(session.user.id);

  // Group tickets: Section A (HIGH or CRITICAL) vs Section B (LOW, MEDIUM, or null)
  const highPriorityTickets = tickets.filter(
    (t) => t.priority === "HIGH" || t.priority === "CRITICAL"
  );
  const normalPriorityTickets = tickets.filter(
    (t) => t.priority === "LOW" || t.priority === "MEDIUM" || !t.priority
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-wider mb-2">
            <Sparkles className="h-4 w-4" />
            <span>Operational Support Queue</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Active Tickets Queue
          </h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl leading-relaxed">
            Manage your open and in-progress tickets, prioritized by their urgency level. Undergoing automated AI classification.
          </p>
        </div>
        <div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-xl border border-border/40 hover:bg-muted/50 hover:text-foreground px-4 py-2.5 text-sm font-semibold transition-all cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>

      {/* KPI Section */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/5 to-red-500/10 p-6 glass flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wide text-rose-400">Critical & High Urgency</span>
            <h3 className="text-3xl font-extrabold mt-1 text-foreground">{highPriorityTickets.length}</h3>
          </div>
          <div className="rounded-xl bg-rose-500/10 p-3 text-rose-400 border border-rose-500/20">
            <ShieldAlert className="h-6 w-6 animate-pulse" />
          </div>
        </div>

        <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-muted/20 to-muted/5 p-6 glass flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Standard & Low Priority</span>
            <h3 className="text-3xl font-extrabold mt-1 text-foreground">{normalPriorityTickets.length}</h3>
          </div>
          <div className="rounded-xl bg-muted p-3 text-muted-foreground">
            <Inbox className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Section A: High & Critical Priority Tickets */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5 border-b border-border/40 pb-3">
          <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0" />
          <h2 className="text-lg font-bold text-foreground">Section A: High & Critical Priority Tickets</h2>
          <span className="rounded-full bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-400">
            {highPriorityTickets.length}
          </span>
        </div>

        {highPriorityTickets.length === 0 ? (
          <div className="rounded-2xl border border-border/40 border-dashed p-12 text-center bg-muted/5 glass">
            <Inbox className="h-8 w-8 text-muted-foreground mb-3 opacity-30 mx-auto" />
            <p className="text-sm font-semibold text-muted-foreground">No high or critical priority tickets found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {highPriorityTickets.map((ticket) => (
              <TicketQueueCard key={ticket.id} ticket={ticket} isHigh />
            ))}
          </div>
        )}
      </div>

      {/* Section B: Normal & Low Priority Tickets */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-2.5 border-b border-border/40 pb-3">
          <Inbox className="h-5 w-5 text-muted-foreground shrink-0" />
          <h2 className="text-lg font-bold text-foreground">Section B: Normal & Low Priority Tickets</h2>
          <span className="rounded-full bg-muted/80 border border-border/60 px-2 py-0.5 text-xs font-bold text-muted-foreground">
            {normalPriorityTickets.length}
          </span>
        </div>

        {normalPriorityTickets.length === 0 ? (
          <div className="rounded-2xl border border-border/40 border-dashed p-12 text-center bg-muted/5 glass">
            <Inbox className="h-8 w-8 text-muted-foreground mb-3 opacity-30 mx-auto" />
            <p className="text-sm font-semibold text-muted-foreground">No standard priority tickets found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {normalPriorityTickets.map((ticket) => (
              <TicketQueueCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TicketQueueCard({ ticket, isHigh = false }: { ticket: any; isHigh?: boolean }) {
  return (
    <div className={`group rounded-2xl border p-5 sm:p-6 transition-all hover:bg-muted/15 flex flex-col md:flex-row md:items-center justify-between gap-6 glass ${
      isHigh 
        ? "border-rose-500/20 bg-gradient-to-r from-rose-500/5 to-transparent hover:border-rose-500/40" 
        : "border-border/40 hover:border-border/80"
    }`}>
      <div className="space-y-3 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tracking-wide ${
            ticket.priority === "CRITICAL"
              ? "bg-red-500 text-white animate-pulse"
              : ticket.priority === "HIGH"
              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
              : ticket.priority === "MEDIUM"
              ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
              : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
          }`}>
            {ticket.priority || "LOW"}
          </span>

          {ticket.category && (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold bg-muted text-muted-foreground border border-border/40 uppercase">
              <Tag className="h-3 w-3" />
              {ticket.category.replace("_", " ")}
            </span>
          )}

          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            ticket.status === "OPEN"
              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
              : ticket.status === "IN_PROGRESS"
              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          }`}>
            {ticket.status.replace("_", " ")}
          </span>

          {ticket.slaBreached && (
            <span className="inline-flex items-center rounded-md bg-rose-500 text-white px-2 py-0.5 text-xs font-bold animate-pulse">
              SLA BREACHED
            </span>
          )}

          {ticket.source && (
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold border ${
              ticket.source === "WHATSAPP"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-blue-500/10 text-blue-400 border-blue-500/20"
            }`}>
              {ticket.source}
            </span>
          )}
        </div>

        <h3 className="text-lg font-bold text-foreground truncate group-hover:text-primary transition-colors">
          {ticket.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-1 max-w-3xl">
          {ticket.description}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <User className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span>Customer: {ticket.user?.name || ticket.user?.email || "Unknown Customer"}</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span>Created: {new Date(ticket.createdAt).toLocaleString()}</span>
          </div>
          <span>•</span>
          <span className="font-mono text-xxs bg-muted px-1.5 py-0.5 rounded border border-border/20">ID: {ticket.id}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end md:self-center shrink-0">
        <Link
          href={`/tickets/${ticket.id}`}
          className="flex items-center gap-1.5 rounded-xl border border-border/40 hover:bg-muted px-4 py-2.5 text-sm font-semibold hover:text-foreground transition-colors cursor-pointer"
        >
          <Eye className="h-4 w-4" />
          View Details
        </Link>
      </div>
    </div>
  );
}
