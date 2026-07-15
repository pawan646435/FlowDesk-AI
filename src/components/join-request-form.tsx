"use client";

import { useActionState } from "react";
import { submitJoinRequestAction } from "@/app/onboarding/actions";
import { UserPlus, Loader2 } from "lucide-react";

// JOIN_REQUEST_DESIGN.md §3.2/§5 — the request form, now wired to submitJoinRequestAction.
// On success the action revalidates /onboarding, whose Server Component re-fetches
// getPendingJoinRequestForUser and switches to the status-card branch — no client-side
// navigation needed, the page's own re-render after revalidatePath handles it.
export function JoinRequestForm() {
  const [state, formAction, isPending] = useActionState(submitJoinRequestAction, null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="ownerEmail" className="text-sm font-semibold text-foreground">
          Team owner&apos;s email
        </label>
        <input
          type="email"
          id="ownerEmail"
          name="ownerEmail"
          required
          placeholder="owner@yourcompany.com"
          className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
        />
        <p className="text-xs text-muted-foreground">
          Your team owner will need to approve this request before you get access.
        </p>
        {state?.fieldErrors?.ownerEmail && (
          <p className="text-xs font-medium text-destructive">{state.fieldErrors.ownerEmail[0]}</p>
        )}
        {state?.error && !state?.fieldErrors && (
          <p className="text-xs font-medium text-destructive">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold shadow-lg glow-purple hover:bg-primary/90 transition-all disabled:opacity-50 cursor-pointer"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4" />
            Request access
          </>
        )}
      </button>
    </form>
  );
}
