"use client";

import { useActionState } from "react";
import { saveWebhookConfigAction } from "@/app/settings/webhook-actions";
import { Save, Loader2 } from "lucide-react";

interface WebhookConfigFormProps {
  defaults: {
    newTicketUrl: string;
    escalationUrl: string;
    negativeSentimentUrl: string;
    resolutionUrl: string;
    slaBreachUrl: string;
  };
}

const FIELDS: { name: keyof WebhookConfigFormProps["defaults"]; label: string }[] = [
  { name: "newTicketUrl", label: "New Ticket" },
  { name: "escalationUrl", label: "High Priority Escalation" },
  { name: "negativeSentimentUrl", label: "Negative Sentiment" },
  { name: "resolutionUrl", label: "Ticket Resolution" },
  { name: "slaBreachUrl", label: "SLA Breach" },
];

export function WebhookConfigForm({ defaults }: WebhookConfigFormProps) {
  const [state, formAction, isPending] = useActionState(saveWebhookConfigAction, null);

  return (
    <form action={formAction} className="space-y-4">
      {FIELDS.map((field) => (
        <div key={field.name} className="space-y-1">
          <label htmlFor={field.name} className="text-sm font-semibold text-foreground">
            {field.label}
          </label>
          <input
            type="text"
            id={field.name}
            name={field.name}
            defaultValue={defaults[field.name]}
            placeholder="https://your-n8n-instance/webhook/..."
            className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
          />
          {state?.fieldErrors?.[field.name] && (
            <p className="text-xs font-medium text-destructive">{state.fieldErrors[field.name]![0]}</p>
          )}
        </div>
      ))}

      {state?.error && !state?.fieldErrors && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive font-medium">
          {state.error}
        </div>
      )}
      {state?.success && (
        <p className="text-xs font-medium text-emerald-400">Webhook settings saved.</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 shadow-md glow-purple cursor-pointer"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save className="h-4 w-4" />
            Save webhook settings
          </>
        )}
      </button>
    </form>
  );
}
