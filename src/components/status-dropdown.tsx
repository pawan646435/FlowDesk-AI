"use client";

import { updateTicketStatusAction } from "@/app/tickets/actions";
import { TicketStatus } from "@prisma/client";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

interface StatusDropdownProps {
  ticketId: string;
  currentStatus: TicketStatus;
}

export function StatusDropdown({ ticketId, currentStatus }: StatusDropdownProps) {
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value as TicketStatus;
    startTransition(async () => {
      const res = await updateTicketStatusAction(ticketId, newStatus);
      if (res?.error) {
        alert(res.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Update Status:</span>
      <div className="relative">
        <select
          value={currentStatus}
          onChange={handleStatusChange}
          disabled={isPending}
          className="rounded-xl border border-border/40 bg-background/50 pl-3 pr-8 py-1.5 text-sm font-semibold focus:border-primary focus:outline-none transition-all disabled:opacity-50 appearance-none cursor-pointer"
        >
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        {isPending ? (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
