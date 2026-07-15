"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { WhatsAppConversationStatus } from "@prisma/client";

/**
 * Server Action: Retrieve all WhatsApp conversations
 */
export async function getConversations() {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    throw new Error("Unauthorized");
  }

  return prisma.whatsAppConversation.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1
      },
      ticket: {
        select: {
          id: true,
          status: true,
          priority: true
        }
      }
    }
  });
}

/**
 * Server Action: Retrieve message log for a specific conversation
 */
export async function getConversationMessages(phoneNumber: string) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    throw new Error("Unauthorized");
  }

  return prisma.whatsAppMessage.findMany({
    where: {
      conversation: { organizationId: session.user.organizationId, phoneNumber }
    },
    orderBy: { createdAt: "asc" }
  });
}

/**
 * Server Action: Get conversation metadata
 */
export async function getConversationByPhone(phoneNumber: string) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    throw new Error("Unauthorized");
  }

  // phoneNumber is no longer globally unique (organizationId + phoneNumber is), so this
  // can no longer be findUnique on phoneNumber alone.
  return prisma.whatsAppConversation.findFirst({
    where: { organizationId: session.user.organizationId, phoneNumber },
    include: {
      ticket: true
    }
  });
}

/**
 * Server Action: Delete all message histories and restore conversation status to ACTIVE
 * to facilitate fresh automated testing.
 */
export async function resetConversation(phoneNumber: string) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // MULTI_TENANCY_DESIGN.md §3: this function previously had no auth check at all, so
    // any caller who could invoke this Server Action could wipe any conversation's message
    // history. Requiring an org-scoped lookup here closes that hole — the deleteMany below
    // can now only ever target a conversation this session's org actually owns.
    const conv = await prisma.whatsAppConversation.findFirst({
      where: { organizationId: session.user.organizationId, phoneNumber }
    });

    if (conv) {
      // Delete all related messages
      await prisma.whatsAppMessage.deleteMany({
        where: { conversationId: conv.id }
      });

      // Reset conversation record
      await prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data: {
          status: WhatsAppConversationStatus.ACTIVE,
          ticketId: null
        }
      });

      revalidatePath("/tickets/whatsapp-simulator");
      revalidatePath("/tickets/whatsapp-history");
      return { success: true };
    }
    return { success: false, error: "Conversation not found" };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Server Action: Mark WhatsApp conversation and its associated ticket as RESOLVED.
 */
export async function resolveConversationAction(phoneNumber: string) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const conv = await prisma.whatsAppConversation.findFirst({
      where: { organizationId: session.user.organizationId, phoneNumber }
    });

    if (conv) {
      await prisma.whatsAppConversation.update({
        where: { id: conv.id },
        data: { status: WhatsAppConversationStatus.RESOLVED }
      });

      if (conv.ticketId) {
        await prisma.ticket.update({
          where: { id: conv.ticketId },
          data: { status: "RESOLVED" }
        });
      }

      revalidatePath("/tickets/whatsapp-simulator");
      revalidatePath("/tickets/whatsapp-history");
      return { success: true };
    }
    return { success: false, error: "Conversation not found" };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Server Action: Send a manual agent reply via WhatsApp and persist as AGENT sender.
 */
export async function sendManualAgentReply(phoneNumber: string, text: string) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const { sendWhatsAppMessage } = await import("@/services/whatsapp.service");

    const conv = await prisma.whatsAppConversation.findFirst({
      where: { organizationId: session.user.organizationId, phoneNumber }
    });

    if (!conv) {
      return { success: false, error: "Conversation not found" };
    }

    await sendWhatsAppMessage(phoneNumber, session.user.organizationId, text, conv.id, "AGENT");

    revalidatePath("/tickets/whatsapp-history");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
