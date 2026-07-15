"use server";

import { createOrganizationWithSelfInviteAndTeam } from "@/services/organization.service";
import { createOrganizationSchema } from "@/lib/validation";
import { redirect } from "next/navigation";
import type { CompanyIndustry, CompanySize } from "@prisma/client";

export async function createOrganizationAction(prevState: unknown, formData: FormData) {
  const orgName = formData.get("orgName") as string;
  const email = formData.get("email") as string;
  const industry = formData.get("industry") as string;
  const size = formData.get("size") as string;
  const website = formData.get("website") as string;
  // Repeatable teammate email rows all share the name="teammateEmails" attribute;
  // getAll collects every non-empty one. Empty rows (a blank "+ Add teammate" row the
  // user never filled in) are filtered out client-side too, but re-filtered here
  // defensively since this is the actual trust boundary.
  const teammateEmails = formData.getAll("teammateEmails")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);

  const validation = createOrganizationSchema.safeParse({
    orgName,
    email,
    industry,
    size,
    website,
    teammateEmails,
  });
  if (!validation.success) {
    return {
      error: "Validation failed",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  let inviteToken: string;
  try {
    const { ownerInvite } = await createOrganizationWithSelfInviteAndTeam(
      validation.data.orgName,
      validation.data.email,
      {
        industry: validation.data.industry as CompanyIndustry,
        size: validation.data.size as CompanySize,
        website: validation.data.website,
      },
      validation.data.teammateEmails ?? []
    );
    inviteToken = ownerInvite.token;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to create organization";
    return { error: errorMessage };
  }

  redirect(`/accept-invite?token=${inviteToken}`);
}
