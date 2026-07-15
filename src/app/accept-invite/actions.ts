"use server";

import { getVerifiedSession } from "@/lib/session";
import { leaveAndJoinOrganization } from "@/services/organization.service";
import { signOut } from "@/auth";

/**
 * TEAM_REMOVAL_DESIGN.md §3.3 — the explicit leave-then-join action. Only reachable from
 * the "existing session AND that session's org differs from the invite's target org"
 * branch on /accept-invite — this is a conscious, explicit user action (clicking a real
 * button), not a silent org-switch triggered by sign-in.
 *
 * §2.3's OWNER-can't-leave block still applies: an OWNER with a pending invite elsewhere
 * still can't leave via this path, consistent with "an OWNER cannot be removed or leave,
 * period" — not re-checked here as a separate guard, since §3.4's open decision #2
 * confirms this scenario only actually arises for a MEMBER (an OWNER accepting an invite
 * elsewhere would still need to leave their current org first, and that's exactly the
 * case §2.3 blocks).
 *
 * Doesn't touch the jwt callback at all — mutates the DB directly, then forces a fresh
 * sign-in (signOut + redirectTo) so the *next* jwt run picks up the new organizationId
 * cleanly via the normal returning-user path, matching the pattern already established
 * for the account-linking security fix on this same page.
 */
export async function leaveAndJoinAction(inviteId: string) {
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) {
    return { error: "Unauthorized" };
  }
  if (session.user.role === "OWNER") {
    return { error: "Organization owners cannot leave their org this way. Contact support to transfer ownership first." };
  }

  try {
    await leaveAndJoinOrganization(session.user.id, inviteId);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to switch organizations";
    return { error: errorMessage };
  }

  await signOut({ redirectTo: "/login" });
}
