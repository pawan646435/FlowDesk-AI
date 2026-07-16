"use client";

import { useActionState, useState } from "react";
import { createOrganizationAction } from "./actions";
import { Building2, Loader2, Plus, X, UserPlus } from "lucide-react";
import { INDUSTRY_OPTIONS, SIZE_OPTIONS } from "@/lib/company-options";
import { MAX_TEAMMATE_INVITES } from "@/lib/constants";

export default function CreateOrganizationPage() {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, null);
  const [teammateEmails, setTeammateEmails] = useState<string[]>([""]);

  const addTeammateRow = () => {
    if (teammateEmails.length >= MAX_TEAMMATE_INVITES) return;
    setTeammateEmails((prev) => [...prev, ""]);
  };

  const removeTeammateRow = (index: number) => {
    setTeammateEmails((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTeammateRow = (index: number, value: string) => {
    setTeammateEmails((prev) => prev.map((v, i) => (i === index ? value : v)));
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background">
      <div className="w-full max-w-xl space-y-8 p-8 rounded-2xl glass border border-border/40 glow-purple">
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

        <form action={formAction} className="mt-8 space-y-8">
          {/* Company details */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Company details
            </h3>

            <div className="space-y-2">
              <label htmlFor="orgName" className="text-sm font-semibold text-foreground">
                Company name
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="industry" className="text-sm font-semibold text-foreground">
                  Industry
                </label>
                <select
                  id="industry"
                  name="industry"
                  required
                  defaultValue=""
                  className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all cursor-pointer"
                >
                  <option value="" disabled>
                    Select industry
                  </option>
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {state?.fieldErrors?.industry && (
                  <p className="text-xs font-medium text-destructive mt-1">
                    {state.fieldErrors.industry[0]}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="size" className="text-sm font-semibold text-foreground">
                  Company size
                </label>
                <select
                  id="size"
                  name="size"
                  required
                  defaultValue=""
                  className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all cursor-pointer"
                >
                  <option value="" disabled>
                    Select size
                  </option>
                  {SIZE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {state?.fieldErrors?.size && (
                  <p className="text-xs font-medium text-destructive mt-1">
                    {state.fieldErrors.size[0]}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="website" className="text-sm font-semibold text-foreground">
                Company website <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="text"
                id="website"
                name="website"
                placeholder="https://acme.com"
                className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
              />
              {state?.fieldErrors?.website && (
                <p className="text-xs font-medium text-destructive mt-1">
                  {state.fieldErrors.website[0]}
                </p>
              )}
            </div>
          </div>

          {/* Creator email */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Your email
            </h3>
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

          {/* Invite your team */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Invite your team <span className="text-muted-foreground font-normal normal-case">(optional)</span>
              </h3>
            </div>

            <div className="space-y-2">
              {teammateEmails.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="email"
                    name="teammateEmails"
                    value={value}
                    onChange={(e) => updateTeammateRow(index, e.target.value)}
                    placeholder="teammate@acme.com"
                    className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
                  />
                  {teammateEmails.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTeammateRow(index)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive transition-colors cursor-pointer"
                      aria-label="Remove teammate"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {state?.fieldErrors?.teammateEmails && (
              <p className="text-xs font-medium text-destructive">
                {state.fieldErrors.teammateEmails[0]}
              </p>
            )}

            {teammateEmails.length < MAX_TEAMMATE_INVITES && (
              <button
                type="button"
                onClick={addTeammateRow}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add teammate
              </button>
            )}

            <p className="text-xs text-muted-foreground">
              They&apos;ll each get an invite link the moment your organization is created. You can also invite people later from Settings.
            </p>
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
              <>
                <UserPlus className="h-4 w-4" />
                Create organization
              </>
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
