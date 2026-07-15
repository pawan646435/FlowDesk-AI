"use server";

import { getVerifiedSession } from "@/lib/session";
import {
  getOwnerOrgForEmail,
  getPendingJoinRequestToOrg,
  createJoinRequest,
} from "@/services/organization.service";
import { joinRequestSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

/**
 * JOIN_REQUEST_DESIGN.md §5 — every case in the resolution table, in order. Only the
 * final case actually creates a row; every other case returns a clear rejection message
 * without touching the database.
 */
export async function submitJoinRequestAction(prevState: unknown, formData: FormData) {
  const session = await getVerifiedSession({ onStale: "unauthorized", requireOrg: false });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const ownerEmail = formData.get("ownerEmail") as string;
  const validation = joinRequestSchema.safeParse({ ownerEmail });
  if (!validation.success) {
    return {
      error: "Validation failed",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  const resolution = await getOwnerOrgForEmail(validation.data.ownerEmail);

  // §5 row 1: no User row for that email at all.
  if (resolution.status === "not_found") {
    return {
      error: "No FlowDesk account found for that email. Ask your team owner to sign in first, or check the address.",
    };
  }

  // §5 row 2: the email belongs to a real User, but not an OWNER (a MEMBER, or orgless).
  if (resolution.status === "not_owner") {
    return {
      error: "That person isn't an organization owner and can't approve join requests. Ask your actual org owner for their email, or check with them for an invite instead.",
    };
  }

  const resolvedOrg = resolution.organization;

  // §5 row 4: requester is already a member of the resolved org.
  if (session.user.organizationId === resolvedOrg.id) {
    return { error: "You're already a member of this organization." };
  }

  // §5 row 3: a PENDING request to this exact org already exists — surfaced as a clean
  // validation message rather than letting the @@unique constraint reject the insert.
  const existingRequest = await getPendingJoinRequestToOrg(session.user.id, resolvedOrg.id);
  if (existingRequest) {
    return { error: `You already have a pending request to ${resolvedOrg.name}.` };
  }

  // §5 row 5: the normal case.
  await createJoinRequest(session.user.id, resolvedOrg.id, validation.data.ownerEmail);
  revalidatePath("/onboarding");
  return { success: true, orgName: resolvedOrg.name };
}
