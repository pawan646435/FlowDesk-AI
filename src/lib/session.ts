import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";

/**
 * TEAM_REMOVAL_DESIGN.md §1.3 — the jwt callback only re-reads the DB on the initial
 * sign-in call (confirmed against @auth/core's session.js action: every subsequent
 * useSession()/auth() call invokes callbacks.jwt with no `user` param, so the token's
 * organizationId/role are returned unchanged with zero DB read). This helper is the
 * per-request staleness check that catches a removal/leave/org-switch that happened
 * since the token was issued — one indexed primary-key lookup, added at the same place
 * every protected page/action already does its auth()-then-redirect check, not a new
 * global mechanism.
 */

type VerifiedSession = Session & { user: Session["user"] & { organizationId: string; role: Session["user"]["role"] } };
// JOIN_REQUEST_DESIGN.md §3.1 — the requireOrg: false variant's return shape. organizationId
// may genuinely be null here (an authenticated-but-orgless user), unlike VerifiedSession above.
type VerifiedSessionAnyOrg = Session & { user: Session["user"] & { organizationId: string | null; role: Session["user"]["role"] } };

/**
 * For pages: resolves the session, verifies session.user.id is present, and (unless
 * requireOrg: false) verifies organizationId is present too. Verifies the token's
 * organizationId/role still match the DB. Redirects to /login on any failure (missing
 * session, missing organizationId when required, or a stale/mismatched token) — a stale
 * token is treated exactly like an expired one, forcing a fresh sign-in that re-runs the
 * jwt callback's `if (user)` branch properly.
 */
export async function getVerifiedSession(options?: { onStale: "redirect"; requireOrg?: true }): Promise<VerifiedSession>;
/**
 * JOIN_REQUEST_DESIGN.md §3.1 — requireOrg: false skips the "no organizationId" redirect,
 * returning a session whose organizationId may be null. Additive: every other call site's
 * default (requireOrg: true, implicit) behavior is completely unchanged by this overload.
 * Used only by /onboarding and the layout/login pages that need to recognize
 * "authenticated, no org" as a distinct, valid state rather than treating it as "no session."
 */
export async function getVerifiedSession(options: { onStale: "redirect"; requireOrg: false }): Promise<VerifiedSessionAnyOrg>;
/**
 * For API routes and Server Actions: same checks, but returns null instead of redirecting
 * on failure — redirect() has no meaningful effect on a fetch() caller or a Server Action
 * invoked from client-side form state, so the caller returns its own 401/{error} shape.
 */
export async function getVerifiedSession(options: { onStale: "unauthorized"; requireOrg?: true }): Promise<VerifiedSession | null>;
export async function getVerifiedSession(options: { onStale: "unauthorized"; requireOrg: false }): Promise<VerifiedSessionAnyOrg | null>;
export async function getVerifiedSession(
  options: { onStale: "redirect" | "unauthorized"; requireOrg?: boolean } = { onStale: "redirect", requireOrg: true }
): Promise<VerifiedSession | VerifiedSessionAnyOrg | null> {
  const requireOrg = options.requireOrg ?? true;
  const session = await auth();

  if (!session?.user?.id || (requireOrg && !session.user.organizationId)) {
    if (options.onStale === "unauthorized") return null;
    redirect("/login");
  }

  // Single indexed lookup (User.id is the primary key) — the cheapest possible read,
  // and it's added at a point every one of these call sites was already about to run at
  // least one org-scoped Prisma query anyway.
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true, role: true },
  });

  const isStale =
    !current ||
    current.organizationId !== session.user.organizationId ||
    current.role !== session.user.role;

  if (isStale) {
    if (options.onStale === "unauthorized") return null;
    redirect("/login");
  }

  return session as VerifiedSession | VerifiedSessionAnyOrg;
}
