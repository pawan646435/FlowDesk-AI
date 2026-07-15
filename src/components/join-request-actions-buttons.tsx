"use client";

import { useState, useTransition } from "react";
import { approveJoinRequestAction, rejectJoinRequestAction } from "@/app/settings/join-request-actions";
import { Check, X, Loader2 } from "lucide-react";

interface JoinRequestActionButtonsProps {
  requestId: string;
  requesterName: string;
}

// JOIN_REQUEST_DESIGN.md §6/§6.1 — matches RemoveMemberButton's useTransition + confirm()
// pattern (TEAM_REMOVAL_DESIGN.md §2.4/§2.5). §6.1 resolved: a lightweight confirm() on
// Approve (it has a real access-granting consequence); no confirm on Reject (rejecting a
// request that was never approved has no comparable stakes, same reasoning §2.5 already
// applied to Reject-style actions).
export function JoinRequestActionButtons({ requestId, requesterName }: JoinRequestActionButtonsProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleApprove = () => {
    if (!confirm(`Approve ${requesterName} to join as MEMBER?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await approveJoinRequestAction(requestId);
      if (result?.error) setError(result.error);
    });
  };

  const handleReject = () => {
    setError(null);
    startTransition(async () => {
      const result = await rejectJoinRequestAction(requestId);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1.5 text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Approve
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Reject
        </button>
      </div>
      {error && (
        <p className="text-xs font-medium text-destructive">{error}</p>
      )}
    </div>
  );
}
