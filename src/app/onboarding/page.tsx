import { getVerifiedSession } from "@/lib/session";
import { getPendingJoinRequestForUser } from "@/services/organization.service";
import { JoinRequestForm } from "@/components/join-request-form";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UserPlus, Clock, Building2 } from "lucide-react";

// JOIN_REQUEST_DESIGN.md §3.2 — the authenticated-but-orgless landing page. Reachable via
// getVerifiedSession({ requireOrg: false }) — genuinely unauthenticated visitors still
// redirect to /login; only the "no organizationId" case is now allowed through here
// instead of being treated identically to "no session" (§1.2's finding).
export default async function OnboardingPage() {
  const session = await getVerifiedSession({ onStale: "redirect", requireOrg: false });

  // Someone with a real org bookmarking this page has nothing to do here.
  if (session.user.organizationId) {
    redirect("/dashboard");
  }

  const pendingRequest = await getPendingJoinRequestForUser(session.user.id);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background">
      <div className="w-full max-w-md space-y-8 p-8 rounded-2xl glass border border-border/40 glow-purple">
        {pendingRequest ? (
          <>
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 shadow-lg mb-4">
                <Clock className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Request pending</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your request to join <span className="font-semibold text-foreground">{pendingRequest.organization.name}</span> is waiting for the owner to approve it. You&apos;ll gain access as soon as they do.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg mb-4 glow-purple">
                <UserPlus className="h-6 w-6" />
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-indigo-300 to-indigo-500 bg-clip-text text-transparent">
                Join your team
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You&apos;re signed in, but not part of an organization yet. Enter your team owner&apos;s email to request access.
              </p>
            </div>

            <JoinRequestForm />
          </>
        )}

        <div className="text-center text-xs text-muted-foreground pt-4 border-t border-border/20 flex items-center justify-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Starting a new company instead?{" "}
          <Link href="/create-organization" className="text-primary hover:underline">
            Create an organization
          </Link>
        </div>
      </div>
    </div>
  );
}
