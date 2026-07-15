"use server";

import { auth } from "@/auth";
import { createTicket, updateTicketStatus } from "@/services/ticket.service";
import { triggerEscalationWebhook } from "@/services/n8n.service";
import { createTicketSchema, updateTicketStatusSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { TicketStatus } from "@prisma/client";

export async function createTicketAction(prevState: unknown, formData: FormData) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return { error: "Unauthorized" };
  }

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const isHighPriority = formData.get("isHighPriority") === "true" || formData.get("isHighPriority") === "on";

  const validation = createTicketSchema.safeParse({ title, description, isHighPriority });
  if (!validation.success) {
    return {
      error: "Validation failed",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  try {
    await createTicket(session.user.id, session.user.organizationId, validation.data);
    revalidatePath("/tickets");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to create ticket";
    return { error: errorMessage };
  }
}

export async function updateTicketStatusAction(ticketId: string, status: TicketStatus) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return { error: "Unauthorized" };
  }

  const validation = updateTicketStatusSchema.safeParse({ status });
  if (!validation.success) {
    return { error: "Invalid status value" };
  }

  try {
    await updateTicketStatus(session.user.id, session.user.organizationId, ticketId, status);
    revalidatePath("/tickets");
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to update status";
    return { error: errorMessage };
  }
}

export async function testEscalationAction() {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return { error: "Unauthorized" };
  }

  const payload = {
    ticketId: "test-escalation-" + Math.floor(100000 + Math.random() * 900000),
    title: "Test Escalation: Brevo SMTP Delivery Verification",
    category: "BILLING" as const,
    priority: "HIGH" as const,
  };

  try {
    const response = await triggerEscalationWebhook(session.user.organizationId, payload);
    return response;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Internal action execution error";
    return { success: false, error: errorMessage };
  }
}
