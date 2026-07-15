"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { leaveOrganizationAction } from "@/app/settings/team-actions";
import { LogOut, Loader2 } from "lucide-react";

// TEAM_REMOVAL_DESIGN.md §2.2/§2.4/§2.5 — MEMBER-only self-leave (server-side already
// blocks OWNER; this component is only ever rendered for a MEMBER per settings/page.tsx's
// role check, so no client-side role gate needed here beyond that). §2.5's confirmation
// decision: browser-native confirm(), not a modal. §2.5's second open decision: the
// session isn't force-invalidated — after a successful leave we push to /login, which
// re-runs getVerifiedSession()'s staleness check on the next render and redirects
// correctly from there; this router.push isn't itself the enforcement, just a UX nicety
// so the user isn't left staring at a page they no longer have access to.
export function LeaveOrgButton() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    if (!confirm("Leave this organization? You'll lose access to its tickets and knowledge base immediately.")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await leaveOrganizationAction();
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.push("/login");
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="flex items-center justify-center gap-2 rounded-xl bg-destructive text-destructive-foreground px-4 py-2.5 text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50 shadow-md cursor-pointer"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        Leave organization
      </button>
      {error && (
        <p className="text-xs font-medium text-destructive">{error}</p>
      )}
    </div>
  );
}
