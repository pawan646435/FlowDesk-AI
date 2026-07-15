import { auth } from "@/auth";
import { getInviteByToken } from "@/services/organization.service";
import { Building2, AlertCircle, LogOut } from "lucide-react";
import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    redirect("/login");
  }

  const invite = await getInviteByToken(token);

  // Auth.js links a new OAuth account to whichever user is currently signed in when the
  // provider callback fires — this happens inside @auth/core before our own signIn/jwt
  // callbacks run, so it cannot be intercepted there. If we let a signed-in user click
  // "Continue with Google" here, accepting an invite for a *different* email would
  // silently attach that invite's identity to their existing account instead of creating
  // a new one. The only reliable fix is never offering that button while a session exists —
  // require an explicit sign-out (via the real signOut() server action, not a client-only
  // one) before letting them proceed.
  const existingSession = await auth();

  let errorMessage: string | null = null;
  if (!invite) {
    errorMessage = "This invite link is invalid.";
  } else if (invite.acceptedAt) {
    errorMessage = "This invite has already been used.";
  } else if (invite.expiresAt < new Date()) {
    errorMessage = "This invite has expired. Ask whoever invited you to send a new one.";
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background">
      <div className="w-full max-w-md space-y-8 p-8 rounded-2xl glass border border-border/40 glow-purple">
        {errorMessage ? (
          <>
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive shadow-lg mb-4">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Invite not valid</h2>
              <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <div className="text-center text-xs text-muted-foreground pt-4 border-t border-border/20">
              <a href="/login" className="text-primary hover:underline">
                Back to sign in
              </a>
            </div>
          </>
        ) : existingSession?.user?.id ? (
          <>
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 shadow-lg mb-4">
                <LogOut className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">You&apos;re already signed in</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This invite is for <span className="font-semibold text-foreground">{invite!.email}</span>, but you&apos;re currently signed in as <span className="font-semibold text-foreground">{existingSession.user.email}</span>. Sign out first, then reopen this link to accept as the invited account.
              </p>
            </div>

            <form
              action={async () => {
                "use server";
                const { signOut } = await import("@/auth");
                await signOut({ redirectTo: `/accept-invite?token=${token}` });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive text-destructive-foreground px-4 py-3 text-sm font-semibold hover:bg-destructive/90 transition-colors shadow-lg cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                Sign out and continue
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg mb-4 glow-purple">
                <Building2 className="h-6 w-6" />
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-indigo-300 to-indigo-500 bg-clip-text text-transparent">
                You&apos;re invited
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Join <span className="font-semibold text-foreground">{invite!.organization.name}</span> on FlowDesk AI. Sign in with Google using <span className="font-semibold text-foreground">{invite!.email}</span> to accept.
              </p>
            </div>

            <form
              action={async () => {
                "use server";
                const { signIn } = await import("@/auth");
                await signIn("google", { redirectTo: "/dashboard" });
              }}
            >
              <button
                type="submit"
                className="relative flex w-full justify-center items-center gap-3 rounded-xl bg-foreground text-background px-4 py-3 text-sm font-semibold hover:bg-foreground/90 transition-colors shadow-lg cursor-pointer"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>Continue with Google</span>
              </button>
            </form>

            <div className="text-center text-xs text-muted-foreground pt-4 border-t border-border/20">
              Make sure to sign in with <span className="font-semibold">{invite!.email}</span> — other Google accounts won&apos;t be accepted for this invite.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
