"use client";

import { useActionState } from "react";
import { createOrganizationAction } from "./actions";
import { Building2, Loader2 } from "lucide-react";

export default function CreateOrganizationPage() {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, null);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background">
      <div className="w-full max-w-md space-y-8 p-8 rounded-2xl glass border border-border/40 glow-purple">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg mb-4 glow-purple">
            <Building2 className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-indigo-300 to-indigo-500 bg-clip-text text-transparent">
            Create your organization
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Set up a new FlowDesk AI workspace for your company. You&apos;ll sign in with the email below to finish setup.
          </p>
        </div>

        <form action={formAction} className="mt-8 space-y-4">
          <div className="space-y-2">
            <label htmlFor="orgName" className="text-sm font-semibold text-foreground">
              Organization name
            </label>
            <input
              type="text"
              id="orgName"
              name="orgName"
              required
              placeholder="Acme Inc."
              className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
            />
            {state?.fieldErrors?.orgName && (
              <p className="text-xs font-medium text-destructive mt-1">
                {state.fieldErrors.orgName[0]}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-semibold text-foreground">
              Your email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              placeholder="you@acme.com"
              className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
            />
            <p className="text-xs text-muted-foreground">
              Use the same email you&apos;ll sign in with via Google.
            </p>
            {state?.fieldErrors?.email && (
              <p className="text-xs font-medium text-destructive mt-1">
                {state.fieldErrors.email[0]}
              </p>
            )}
          </div>

          {state?.error && !state?.fieldErrors && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive font-medium">
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 shadow-lg glow-purple cursor-pointer"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create organization"
            )}
          </button>
        </form>

        <div className="text-center text-xs text-muted-foreground pt-4 border-t border-border/20">
          Already have an invite?{" "}
          <a href="/login" className="text-primary hover:underline">
            Sign in instead
          </a>
        </div>
      </div>
    </div>
  );
}
