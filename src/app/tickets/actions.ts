"use server";

import { auth } from "@/auth";
import { createTicket, updateTicketStatus } from "@/services/ticket.service";
import { createTicketSchema, updateTicketStatusSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { TicketStatus } from "@prisma/client";

export async function createTicketAction(prevState: unknown, formData: FormData) {
  const session = await auth();
  if (!session || !session.user?.id) {
    return { error: "Unauthorized" };
  }

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;

  const validation = createTicketSchema.safeParse({ title, description });
  if (!validation.success) {
    return {
      error: "Validation failed",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  try {
    await createTicket(session.user.id, validation.data);
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
  if (!session || !session.user?.id) {
    return { error: "Unauthorized" };
  }

  const validation = updateTicketStatusSchema.safeParse({ status });
  if (!validation.success) {
    return { error: "Invalid status value" };
  }

  try {
    await updateTicketStatus(session.user.id, ticketId, status);
    revalidatePath("/tickets");
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Failed to update status";
    return { error: errorMessage };
  }
}
