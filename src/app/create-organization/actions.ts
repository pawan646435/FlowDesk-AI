"use server";

import { createOrganizationWithSelfInvite } from "@/services/organization.service";
import { createOrganizationSchema } from "@/lib/validation";
import { redirect } from "next/navigation";

export async function createOrganizationAction(prevState: unknown, formData: FormData) {
  const orgName = formData.get("orgName") as string;
  const email = formData.get("email") as string;

  const validation = createOrganizationSchema.safeParse({ orgName, email });
  if (!validation.success) {
    return {
      error: "Validation failed",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  let inviteToken: string;
  try {
    const { invite } = await createOrganizationWithSelfInvite(
      validation.data.orgName,
      validation.data.email
    );
    inviteToken = invite.token;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to create organization";
    return { error: errorMessage };
  }

  redirect(`/accept-invite?token=${inviteToken}`);
}
