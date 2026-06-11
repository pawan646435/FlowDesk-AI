import { auth } from "@/auth";
import { getTicketById } from "@/services/ticket.service";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { StatusDropdown } from "@/components/status-dropdown";
import { ArrowLeft, Clock, Calendar } from "lucide-react";

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
