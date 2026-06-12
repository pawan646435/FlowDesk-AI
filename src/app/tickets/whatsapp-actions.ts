"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { WhatsAppConversationStatus } from "@prisma/client";

/**
 * Server Action: Retrieve all WhatsApp conversations
 */
export async function getConversations() {
  return prisma.whatsAppConversation.findMany({
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
  return prisma.whatsAppMessage.findMany({
    where: {
      conversation: { phoneNumber }
    },
    orderBy: { createdAt: "asc" }
  });
}

/**
 * Server Action: Get conversation metadata
 */
export async function getConversationByPhone(phoneNumber: string) {
  return prisma.whatsAppConversation.findUnique({
    where: { phoneNumber },
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
  try {
    const conv = await prisma.whatsAppConversation.findUnique({
      where: { phoneNumber }
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
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Server Action: Mark WhatsApp conversation and its associated ticket as RESOLVED.
 */
export async function resolveConversationAction(phoneNumber: string) {
  try {
    const conv = await prisma.whatsAppConversation.findUnique({
      where: { phoneNumber }
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
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Server Action: Send a manual agent reply via WhatsApp and persist as AGENT sender.
 */
export async function sendManualAgentReply(phoneNumber: string, text: string) {
  try {
    const { sendWhatsAppMessage } = await import("@/services/whatsapp.service");
    
    const conv = await prisma.whatsAppConversation.findUnique({
      where: { phoneNumber }
    });

    if (!conv) {
      return { success: false, error: "Conversation not found" };
    }

    await sendWhatsAppMessage(phoneNumber, text, conv.id, "AGENT");
    
    revalidatePath("/tickets/whatsapp-history");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}


