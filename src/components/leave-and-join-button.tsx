"use client";

import { useState, useTransition } from "react";
import { leaveAndJoinAction } from "@/app/accept-invite/actions";
import { ArrowRightLeft, Loader2 } from "lucide-react";

interface LeaveAndJoinButtonProps {
  inviteId: string;
  targetOrgName: string;
}

// TEAM_REMOVAL_DESIGN.md §3.3 — leaveAndJoinAction can fail (e.g. an OWNER is blocked
// per §2.3, or the invite went stale between page load and submit); those errors need
// somewhere to render, so this is a client component rather than an inline "use server"
// form action like the page's other two branches use — a bare form action would have
// nowhere to show a returned {error} without navigating away.
export function LeaveAndJoinButton({ inviteId, targetOrgName }: LeaveAndJoinButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await leaveAndJoinAction(inviteId);
      if (result?.error) {
        setError(result.error);
      }
      // On success, leaveAndJoinAction itself calls signOut({ redirectTo: "/login" }),
      // which throws a redirect — no further handling needed here.
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-white px-4 py-3 text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 shadow-lg cursor-pointer"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
        Leave current org and join {targetOrgName}
      </button>
      {error && (
        <p className="text-xs font-medium text-destructive text-center">{error}</p>
      )}
    </div>
  );
}
