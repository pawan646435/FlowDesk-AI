import Link from "next/link";
import { auth } from "@/auth";
import { ArrowRight, Shield, Clock, BarChart3, Zap, Smartphone, Sparkles } from "lucide-react";

export default async function LandingPage() {
  const session = await auth();

  return (
    <div className="relative isolate min-h-[calc(100vh-4rem)] overflow-hidden bg-background">
      {/* Background grid and ambient glows */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      
      <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80" aria-hidden="true">
        <div className="relative left-[calc(50%-11rem)] aspect-1155/678 w-[36rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-primary to-indigo-600 opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.5rem]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-10 pb-24 sm:pb-32 lg:flex lg:px-8 lg:py-24">
        <div className="mx-auto max-w-2xl flex-shrink-0 lg:mx-0 lg:max-w-xl lg:pt-8">
          <div className="inline-flex items-center space-x-2 rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-medium leading-6 text-emerald-450 ring-1 ring-inset ring-emerald-500/20">
            <span>FlowDesk AI Omnichannel v3.0</span>
          </div>
          
          <h1 className="mt-10 text-4xl font-extrabold tracking-tight sm:text-6xl text-foreground">
            Modern Customer Support,{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">
              Simplified.
            </span>
          </h1>
          
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            A production-ready ticketing platform supercharged with stateful n8n automation, real-time AI categorization, sentiment alerts, intelligent support summaries, and now fully integrated with stateful **WhatsApp Support**.
          </p>
          
          <div className="mt-10 flex items-center gap-x-6">
            <Link
              href={session ? "/dashboard" : "/login"}
              className="group flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold shadow-lg hover:bg-primary/90 transition-all glow-purple cursor-pointer"
            >
              {session ? "Go to Dashboard" : "Get Started Now"}
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            
            <a
              href="#features"
              className="text-sm font-semibold leading-6 text-foreground hover:text-primary transition-colors cursor-pointer"
            >
              Learn more <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>

        {/* Hero Features Grid */}
        <div className="mx-auto mt-16 flex max-w-2xl sm:mt-24 lg:ml-10 lg:mr-0 lg:mt-0 lg:max-w-none lg:flex-none xl:ml-20">
          <div className="max-w-3xl flex-none sm:max-w-5xl lg:max-w-none">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:w-[36rem]">
              <div className="p-6 rounded-2xl glass border border-border/40 hover:border-primary/20 transition-all hover:-translate-y-1 duration-300">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 mb-4">
                  <Smartphone className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-lg">WhatsApp Channel</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Full stateful conversational channel. Agents manually chat or let Gemini handle the support workflow.
                </p>
              </div>

              <div className="p-6 rounded-2xl glass border border-border/40 hover:border-primary/20 transition-all hover:-translate-y-1 duration-300">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-lg">Gemini support agent</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Autonomously answers self-service tickets, classifies sentiment/priority, and escalates when needed.
                </p>
              </div>

              <div className="p-6 rounded-2xl glass border border-border/40 hover:border-primary/20 transition-all hover:-translate-y-1 duration-300">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
                  <Zap className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-lg">Stateful n8n automation</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Decoupled operational flows running ticket SLA timers, callbacks, alerts, and DB sync status updates.
                </p>
              </div>

              <div className="p-6 rounded-2xl glass border border-border/40 hover:border-primary/20 transition-all hover:-translate-y-1 duration-300">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
                  <Shield className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-lg">Secure Google Auth</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Enterprise-grade authentication with Google OAuth powered by Auth.js.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

