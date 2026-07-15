"use server";

import { getVerifiedSession } from "@/lib/session";
import { createTeamInvite } from "@/services/organization.service";
import { sendInviteSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";

export async function sendInviteAction(prevState: unknown, formData: FormData) {
  // TEAM_REMOVAL_DESIGN.md §1.4 — OWNER-only mutating action, checked for staleness inline
  // (not just on page load): a removed/demoted OWNER's already-open tab must not be able
  // to invite teammates into an org they no longer own, even before their next navigation
  // hits the page-level check.
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) {
    return { error: "Unauthorized" };
  }
  if (session.user.role !== "OWNER") {
    return { error: "Only organization owners can invite teammates." };
  }

  const email = formData.get("email") as string;
  const validation = sendInviteSchema.safeParse({ email });
  if (!validation.success) {
    return {
      error: "Validation failed",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  try {
    await createTeamInvite(session.user.organizationId, session.user.id, validation.data.email);
    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to send invite";
    return { error: errorMessage };
  }
}

/**
 * TEAM_REMOVAL_DESIGN.md §2.1 — OWNER removes a MEMBER from their org. Update, never
 * delete: clears organizationId/role rather than deleting the User row, which would
 * cascade-delete the removed user's tickets/activities and any invites they sent
 * (see §4/§5's findings on Ticket.user/Activity.user/Invite.invitedBy's onDelete: Cascade).
 */
export async function removeMemberAction(targetUserId: string) {
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) {
    return { error: "Unauthorized" };
  }
  if (session.user.role !== "OWNER") {
    return { error: "Only organization owners can remove teammates." };
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { organizationId: true, role: true },
  });

  // The target must actually be in the caller's org — an OWNER must not be able to clear
  // an arbitrary user's org membership by guessing/tampering with a user id from a
  // different org (MULTI_TENANCY_DESIGN.md §3's "the where clause re-checks org
  // membership" discipline, applied here).
  if (!targetUser || targetUser.organizationId !== session.user.organizationId) {
    return { error: "User not found in your organization." };
  }

  // §2.3 — every org has exactly one OWNER by construction (no promote-to-OWNER path
  // exists anywhere in the app), so this action never operates on an OWNER target, full
  // stop. Not "block only if they're the last one" — there is no code path today that
  // produces a second OWNER to fall back to.
  if (targetUser.role === "OWNER") {
    return { error: "Organization owners cannot be removed." };
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { organizationId: null, role: null },
  });

  revalidatePath("/settings");
  return { success: true };
}

/**
 * TEAM_REMOVAL_DESIGN.md §2.2 — a MEMBER voluntarily leaves their own org. No cross-user
 * authorization check needed (unlike removeMemberAction) — acting on session.user.id
 * needs no additional "is this really my own row" verification.
 */
export async function leaveOrganizationAction() {
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) {
    return { error: "Unauthorized" };
  }
  // §2.3 — same invariant as removeMemberAction: an OWNER can never leave via this
  // action, since every org has exactly one OWNER by construction.
  if (session.user.role === "OWNER") {
    return { error: "Organization owners cannot leave. Contact support to transfer ownership first." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { organizationId: null, role: null },
  });

  revalidatePath("/settings");
  return { success: true };
}
