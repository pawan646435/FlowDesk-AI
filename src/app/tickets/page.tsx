import { getVerifiedSession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTickets } from "@/services/ticket.service";
import { CreateTicketDialog } from "@/components/create-ticket-dialog";
import { TicketStatus } from "@prisma/client";
import { Ticket, Eye } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function TicketsPage({ searchParams }: PageProps) {
  // JOIN_REQUEST_DESIGN.md §3.3 — same pattern as dashboard/page.tsx.
  const initialSession = await getVerifiedSession({ onStale: "redirect", requireOrg: false });
  if (!initialSession.user.organizationId) {
    redirect("/onboarding");
  }

  const session = await getVerifiedSession();

  const resolvedSearchParams = await searchParams;
  const filterStatus = resolvedSearchParams.status;

  let statusQuery: TicketStatus | undefined;
  if (
    filterStatus === "OPEN" ||
    filterStatus === "IN_PROGRESS" ||
    filterStatus === "RESOLVED"
  ) {
    statusQuery = filterStatus as TicketStatus;
  }

  const tickets = await getTickets(session.user.organizationId, statusQuery);

  const filters = [
    { label: "All Tickets", value: "" },
    { label: "Open", value: "OPEN" },
    { label: "In Progress", value: "IN_PROGRESS" },
    { label: "Resolved", value: "RESOLVED" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
          <p className="text-muted-foreground mt-1">
            Create, view, and manage your active customer support requests.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/tickets/test-escalation"
            className="flex items-center gap-2 rounded-xl border border-border/40 hover:bg-muted px-4 py-2.5 text-sm font-semibold hover:text-foreground transition-all cursor-pointer"
          >
            Test Escalation
          </Link>
          <CreateTicketDialog />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 border-b border-border/40 pb-4">
        {filters.map((filter) => {
          const isActive = (filter.value === "" && !filterStatus) || filter.value === filterStatus;
          const href = filter.value ? `/tickets?status=${filter.value}` : "/tickets";
          return (
            <Link
              key={filter.label}
              href={href}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm glow-purple"
                  : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {/* Tickets List */}
      <div className="rounded-2xl border border-border/40 glass overflow-hidden">
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4 opacity-40" />
            <h4 className="text-xl font-semibold">No tickets found</h4>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              We couldn&apos;t find any tickets matching the selected filter. Try changing your status filter or create a new support ticket above.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="p-6 hover:bg-muted/10 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="font-semibold text-lg text-foreground truncate">
                      {ticket.title}
                    </h4>
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
                    {ticket.priority && (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          ticket.priority === "HIGH"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse"
                            : ticket.priority === "MEDIUM"
                            ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                            : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                        }`}
                      >
                        {ticket.priority}
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
                        {ticket.source.toLowerCase()}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {ticket.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                    <span>ID: {ticket.id}</span>
                    <span>•</span>
                    <span>Created: {new Date(ticket.createdAt).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>Updated: {new Date(ticket.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="flex items-center gap-1.5 rounded-xl border border-border/40 hover:bg-muted px-4 py-2.5 text-sm font-semibold hover:text-foreground transition-colors cursor-pointer"
                  >
                    <Eye className="h-4 w-4" />
                    Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
