"use client";

import { useState, useTransition } from "react";
import { removeMemberAction } from "@/app/settings/team-actions";
import { UserMinus, Loader2 } from "lucide-react";

interface RemoveMemberButtonProps {
  memberId: string;
  memberName: string;
}

// TEAM_REMOVAL_DESIGN.md §2.4/§2.5 — removeMemberAction takes a positional targetUserId,
// not FormData, so this isn't wired through a <form>/useActionState like the invite form;
// a plain button + useTransition is the simpler fit. §2.5 resolves the confirmation-step
// decision as a simple browser-native confirm(), not a full modal.
export function RemoveMemberButton({ memberId, memberName }: RemoveMemberButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (!confirm(`Remove ${memberName} from this organization? They'll lose access immediately on their next page load.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction(memberId);
      if (result?.error) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
        Remove
      </button>
      {error && (
        <p className="text-xs font-medium text-destructive">{error}</p>
      )}
    </div>
  );
}
