"use server";

import { auth } from "@/auth";
import { createTeamInvite } from "@/services/organization.service";
import { sendInviteSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

export async function sendInviteAction(prevState: unknown, formData: FormData) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
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
