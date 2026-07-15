"use server";

import { getVerifiedSession } from "@/lib/session";
import { upsertOrganizationWebhookConfig } from "@/services/organization.service";
import { webhookConfigSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

export async function saveWebhookConfigAction(prevState: unknown, formData: FormData) {
  // TEAM_REMOVAL_DESIGN.md §1.4 — same reasoning as sendInviteAction: checked for
  // staleness inline, not just on page load.
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) {
    return { error: "Unauthorized" };
  }
  if (session.user.role !== "OWNER") {
    return { error: "Only organization owners can edit webhook settings." };
  }

  const raw = {
    newTicketUrl: formData.get("newTicketUrl") as string,
    escalationUrl: formData.get("escalationUrl") as string,
    negativeSentimentUrl: formData.get("negativeSentimentUrl") as string,
    resolutionUrl: formData.get("resolutionUrl") as string,
    slaBreachUrl: formData.get("slaBreachUrl") as string,
  };

  const validation = webhookConfigSchema.safeParse(raw);
  if (!validation.success) {
    return {
      error: "Validation failed",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  try {
    await upsertOrganizationWebhookConfig(session.user.organizationId, validation.data);
    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to save webhook settings";
    return { error: errorMessage };
  }
}
