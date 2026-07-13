"use client";

import { useState, useTransition } from "react";
import { testEscalationAction } from "../actions";
import Link from "next/link";
import { ArrowLeft, Play, Server, Send, AlertTriangle, CheckCircle, Terminal } from "lucide-react";

interface EscalationTestResult {
  success?: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export default function TestEscalationPage() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<EscalationTestResult | null>(null);

  const handleTrigger = () => {
    setResult(null);
    startTransition(async () => {
      const res = await testEscalationAction();
      setResult(res);
    });
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Navigation */}
      <div>
        <Link
          href="/tickets"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tickets
        </Link>
      </div>

      {/* Hero Header */}
      <div className="rounded-2xl border border-border/40 p-6 sm:p-8 glass space-y-4">
        <div className="flex items-center gap-3 text-primary">
          <Terminal className="h-6 w-6" />
          <span className="text-xs font-bold uppercase tracking-wider">Escalation Testing Sandbox</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          n8n High Priority Escalation Test
        </h1>
        <p className="text-muted-foreground max-w-2xl leading-relaxed text-sm">
          Use this testing sandbox to dispatch a mock <span className="text-rose-400 font-semibold">HIGH</span> priority payload directly to your local n8n escalation webhook. Verify SMTP routing, Brevo credentials, and inspect the response payload in real time without creating a real database ticket.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Control Panel */}
        <div className="rounded-2xl border border-border/40 p-6 glass space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-foreground">Control Panel</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Clicking the button will execute a POST request to:
              <code className="block mt-2 p-2 bg-muted/50 rounded-lg text-xxs font-mono text-primary select-all break-all border border-border/20">
                http://localhost:5678/webhook/escalate-ticket
              </code>
            </p>

            <div className="rounded-xl bg-muted/20 border border-border/20 p-4 space-y-2.5">
              <span className="text-xxs font-bold text-muted-foreground uppercase tracking-wide">Test Payload Details</span>
              <div className="space-y-1 text-xs font-medium">
                <div className="flex justify-between"><span className="text-muted-foreground">Priority:</span> <span className="text-rose-400 font-semibold">HIGH</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Category:</span> <span>BILLING</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Title:</span> <span className="truncate max-w-[140px]" title="Test Escalation: Brevo SMTP Delivery Verification">Test Escalation...</span></div>
              </div>
            </div>
          </div>

          <button
            onClick={handleTrigger}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 shadow-md glow-purple cursor-pointer mt-4"
          >
            {isPending ? (
              <>
                <Server className="h-4 w-4 animate-spin" />
                Dispatching...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Trigger Webhook
              </>
            )}
          </button>
        </div>

        {/* Execution Results */}
        <div className="md:col-span-2 rounded-2xl border border-border/40 p-6 glass flex flex-col min-h-[300px]">
          <h3 className="text-lg font-bold text-foreground mb-4">Realtime Response Console</h3>

          {!result && !isPending && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-border/40 rounded-xl bg-muted/5">
              <Terminal className="h-10 w-10 text-muted-foreground mb-3 opacity-30" />
              <p className="text-sm font-medium text-muted-foreground">
                No payload dispatched. Click the button to launch a test execution.
              </p>
            </div>
          )}

          {isPending && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <Send className="h-10 w-10 text-primary mb-4 animate-bounce" />
              <p className="text-sm font-semibold text-foreground">Sending test payload to n8n webhook...</p>
              <p className="text-xs text-muted-foreground mt-1">Waiting for Brevo SMTP and response triggers</p>
            </div>
          )}

          {result && (
            <div className="flex-1 space-y-4">
              {/* Status Header */}
              <div className={`rounded-xl p-4 border flex items-start gap-3 ${
                result.success
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-rose-500/10 border-rose-500/20 text-rose-400"
              }`}>
                {result.success ? (
                  <CheckCircle className="h-5 w-5 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                )}
                <div>
                  <h4 className="font-bold text-sm">
                    {result.success ? "Escalation Triggered Successfully" : "Webhook Trigger Failed"}
                  </h4>
                  <p className="text-xs mt-1 text-foreground/80 leading-relaxed">
                    {result.success
                      ? `n8n webhook received payload and returned HTTP ${result.status || 200}.`
                      : result.error || "A connection exception occurred."}
                  </p>
                </div>
              </div>

              {/* Payload/Data Display */}
              <div className="space-y-2 flex-1 flex flex-col">
                <span className="text-xs font-semibold text-muted-foreground">Response Body JSON</span>
                <pre className="flex-1 p-4 rounded-xl bg-background/50 border border-border/40 text-xs font-mono overflow-auto max-h-[200px] text-foreground select-all leading-normal">
                  {JSON.stringify(result.data || result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
