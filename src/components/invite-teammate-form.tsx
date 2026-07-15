"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendInviteAction } from "@/app/settings/team-actions";
import { UserPlus, Loader2 } from "lucide-react";

export function InviteTeammateForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(sendInviteAction, null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col sm:flex-row gap-3">
      <div className="flex-1 space-y-1">
        <input
          type="email"
          name="email"
          required
          placeholder="teammate@company.com"
          className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
        />
        {state?.fieldErrors?.email && (
          <p className="text-xs font-medium text-destructive">{state.fieldErrors.email[0]}</p>
        )}
        {state?.error && !state?.fieldErrors && (
          <p className="text-xs font-medium text-destructive">{state.error}</p>
        )}
        {state?.success && (
          <p className="text-xs font-medium text-emerald-400">Invite sent.</p>
        )}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 shadow-md glow-purple cursor-pointer"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4" />
            Invite
          </>
        )}
      </button>
    </form>
  );
}
