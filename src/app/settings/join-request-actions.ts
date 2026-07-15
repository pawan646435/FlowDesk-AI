"use server";

import { getVerifiedSession } from "@/lib/session";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/**
 * JOIN_REQUEST_DESIGN.md §7.1 — OWNER approves a pending JoinRequest. Always assigns
 * role: "MEMBER", never reads a role from the request — there is no role field on
 * JoinRequest to begin with (§4), so this is airtight by construction, not convention:
 * this action can never be the mechanism that creates a second OWNER
 * (TEAM_REMOVAL_DESIGN.md §2.3's one-OWNER-per-org invariant).
 */
export async function approveJoinRequestAction(requestId: string) {
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) return { error: "Unauthorized" };
  if (session.user.role !== "OWNER") return { error: "Only organization owners can approve join requests." };

  const request = await prisma.joinRequest.findUnique({ where: { id: requestId } });
  // Cross-org-tamper discipline, matching removeMemberAction's exact pattern
  // (TEAM_REMOVAL_DESIGN.md §2.1) — an OWNER must not be able to approve/reject a
  // request belonging to a different org by guessing/tampering with a request id.
  if (!request || request.organizationId !== session.user.organizationId || request.status !== "PENDING") {
    return { error: "Request not found." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: request.requesterId },
      data: { organizationId: request.organizationId, role: "MEMBER" },
    }),
    prisma.joinRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", resolvedAt: new Date(), resolvedById: session.user.id },
    }),
  ]);

  revalidatePath("/settings");
  return { success: true };
}

/**
 * JOIN_REQUEST_DESIGN.md §7.1 — same auth/tamper checks as approval, simpler body: no
 * transaction needed since rejection doesn't touch User. §6.1 open decision, resolved —
 * no rejection-reason field; the requester's /onboarding view simply stops showing this
 * as pending (the form becomes available again).
 */
export async function rejectJoinRequestAction(requestId: string) {
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) return { error: "Unauthorized" };
  if (session.user.role !== "OWNER") return { error: "Only organization owners can reject join requests." };

  const request = await prisma.joinRequest.findUnique({ where: { id: requestId } });
  if (!request || request.organizationId !== session.user.organizationId || request.status !== "PENDING") {
    return { error: "Request not found." };
  }

  await prisma.joinRequest.update({
    where: { id: request.id },
    data: { status: "REJECTED", resolvedAt: new Date(), resolvedById: session.user.id },
  });

  revalidatePath("/settings");
  return { success: true };
}
