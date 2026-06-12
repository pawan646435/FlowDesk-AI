import prisma from "@/lib/prisma";
import { 
  WhatsAppConversationStatus, 
  MessageSender, 
  TicketStatus, 
  TicketPriority, 
  TicketCategory, 
  TicketSentiment,
  TicketSource
} from "@prisma/client";
import { analyzeWhatsAppMessage } from "@/services/gemini.service";
import { 
  triggerNewTicketWebhook, 
  triggerEscalationWebhook, 
  triggerNegativeSentimentWebhook 
} from "@/services/n8n.service";

/**
 * Helper function to perform fetch with exponential backoff retries for Meta Messages API.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  delay = 500
): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, options);
      if (response.ok || attempt >= maxRetries) {
        return response;
      }
      console.warn(`[WhatsApp Service] [Retry Helper] Meta API call failed with status ${response.status}. Attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${delay}ms...`);
    } catch (err: any) {
      if (attempt >= maxRetries) {
        throw err;
      }
      console.warn(`[WhatsApp Service] [Retry Helper] Meta API call failed with error: ${err.message}. Attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${delay}ms...`);
    }
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2;
  }
}

/**
 * Sends an outgoing WhatsApp message.
 * Integrates with Meta Cloud API if credentials are configured,
 * otherwise runs in logged mock fallback mode.
 */
export async function sendWhatsAppMessage(
  phoneNumber: string, 
  text: string, 
  conversationId?: string,
  sender: MessageSender = MessageSender.AI
) {
  let finalConvId = conversationId;

  // 1. If conversationId is not provided, resolve or create active session
  if (!finalConvId) {
    let conversation = await prisma.whatsAppConversation.findFirst({
      where: { 
        phoneNumber,
        status: { in: [WhatsAppConversationStatus.ACTIVE, WhatsAppConversationStatus.ESCALATED] }
      }
    });

    if (!conversation) {
      conversation = await prisma.whatsAppConversation.create({
        data: {
          phoneNumber,
          customerName: "WhatsApp User",
          status: WhatsAppConversationStatus.ACTIVE
        }
      });
    }
    finalConvId = conversation.id;
  }

  // 2. Save the outgoing message to the database
  await prisma.whatsAppMessage.create({
    data: {
      conversationId: finalConvId,
      sender,
      text
    }
  });

  // 3. Make Meta Cloud API call if configured
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (token && phoneId && token !== "mock" && phoneId !== "mock") {
    try {
      const response = await fetchWithRetry(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phoneNumber,
          type: "text",
          text: { body: text }
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error(`[WhatsApp Service] Meta API error details: ${errBody}`);
      } else {
        console.log(`[WhatsApp Service] Message successfully sent via Meta API to ${phoneNumber}`);
      }
    } catch (err) {
      console.error("[WhatsApp Service] Failed to send message via Meta API, logging only:", err);
    }
  } else {
    console.log(`[WhatsApp Service] [MOCK OUTGOING] To: ${phoneNumber} | Content: "${text}"`);
  }
}

/**
 * Process an incoming WhatsApp message.
 * Handles stateful sessioning, Gemini Support Agent replies, ticket escalation, and n8n webhook triggers.
 */
export async function handleIncomingWhatsAppMessage(
  phoneNumber: string, 
  customerName: string | null, 
  text: string
): Promise<string> {
  console.log(`[WhatsApp Service] Incoming message from ${phoneNumber} (${customerName || "Unknown"}): "${text}"`);

  // 1. Resolve or create active conversation
  let conversation = await prisma.whatsAppConversation.findUnique({
    where: { phoneNumber },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });

  if (!conversation) {
    conversation = await prisma.whatsAppConversation.create({
      data: {
        phoneNumber,
        customerName: customerName || "WhatsApp User",
        status: WhatsAppConversationStatus.ACTIVE
      },
      include: { messages: true }
    });
  }

  // If the conversation was resolved, reset it to active for the new query
  if (conversation.status === WhatsAppConversationStatus.RESOLVED) {
    conversation = await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        status: WhatsAppConversationStatus.ACTIVE,
        ticketId: null
      },
      include: { messages: { orderBy: { createdAt: "asc" } } }
    });
  }

  // 2. Save customer's incoming message
  const incomingMsgRecord = await prisma.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      sender: MessageSender.CUSTOMER,
      text
    }
  });

  // Add new message to the local list for Gemini context
  const fullHistory = [...conversation.messages, incomingMsgRecord];

  // 3. Handle Escalated State:
  // If conversation is already escalated, do not run Gemini AI conversational reply.
  // Instead, direct to the human queue/ticket and return a standard auto-responder.
  if (conversation.status === WhatsAppConversationStatus.ESCALATED) {
    const ticketId = conversation.ticketId;
    let autoReply = "Your request is currently with our support engineering team. An agent will follow up with you shortly.";
    if (ticketId) {
      autoReply += ` Your active ticket reference is #${ticketId}.`;
    }
    
    // Send to user and store in DB
    await sendWhatsAppMessage(phoneNumber, autoReply, conversation.id);
    return autoReply;
  }

  // 4. Invoke Gemini AI Support Agent
  const historyItems = fullHistory.map(m => ({
    sender: m.sender as "CUSTOMER" | "AI" | "SYSTEM" | "AGENT",
    text: m.text,
    createdAt: m.createdAt
  }));

  const aiResult = await analyzeWhatsAppMessage(text, historyItems);
  console.log(`[WhatsApp Service] Gemini assessment for ${phoneNumber}: needsEscalation=${aiResult.needsEscalation}`);

  // 5. Handle Escalation Action
  if (aiResult.needsEscalation) {
    // A. Fetch first user in DB to assign the ticket (or create system agent user if empty)
    let systemUser = await prisma.user.findFirst();
    if (!systemUser) {
      systemUser = await prisma.user.create({
        data: {
          name: "System Agent",
          email: "whatsapp-system@flowdesk.ai"
        }
      });
    }

    // B. Build ticket properties from AI prediction
    const category = (aiResult.ticketData?.category as TicketCategory) || TicketCategory.GENERAL_INQUIRY;
    const priority = (aiResult.ticketData?.priority as TicketPriority) || TicketPriority.MEDIUM;
    const sentiment = (aiResult.ticketData?.sentiment as TicketSentiment) || TicketSentiment.NEUTRAL;
    const aiSummary = aiResult.ticketData?.aiSummary || `WhatsApp support request from ${phoneNumber}`;
    const keyIssues = aiResult.ticketData?.keyIssues || "whatsapp request";
    const recommendedTeam = aiResult.ticketData?.recommendedTeam || "Technical Support";

    console.log(`[WhatsApp Service] Escalating to support ticket. Category=${category}, Priority=${priority}`);

    // C. Create Ticket in DB
    const ticket = await prisma.ticket.create({
      data: {
        title: aiResult.ticketData?.title || `WhatsApp Escalation from ${phoneNumber}`,
        description: aiResult.ticketData?.description || text,
        userId: systemUser.id,
        status: TicketStatus.OPEN,
        category,
        priority,
        userPriority: priority,
        aiPriority: priority,
        sentiment,
        aiSummary,
        keyIssues,
        recommendedTeam,
        source: TicketSource.WHATSAPP
      }
    });

    // D. Update WhatsApp Conversation state
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        status: WhatsAppConversationStatus.ESCALATED,
        ticketId: ticket.id
      }
    });

    // E. Save activity timelines for auditing
    await prisma.activity.create({
      data: {
        userId: systemUser.id,
        ticketId: ticket.id,
        action: `Ticket created via WhatsApp message from ${phoneNumber}`
      }
    });

    await prisma.activity.create({
      data: {
        userId: systemUser.id,
        ticketId: ticket.id,
        action: `AI WhatsApp Analysis: Escalated. Category=${category}, Priority=${priority}, Sentiment=${sentiment}`
      }
    });

    // F. Trigger n8n Automation Webhooks
    const payload = {
      ticketId: ticket.id,
      title: ticket.title,
      category: category as "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT" | "ACCOUNT_ACCESS" | "SUBSCRIPTION" | "GENERAL_INQUIRY",
      priority: priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    };

    const newTicketResponse = await triggerNewTicketWebhook(payload);
    if (newTicketResponse.success) {
      await prisma.activity.create({
        data: {
          userId: systemUser.id,
          ticketId: ticket.id,
          action: "Workflow Triggered: New Ticket Automation",
        },
      });
    }

    if (ticket.priority === TicketPriority.HIGH || ticket.priority === TicketPriority.CRITICAL) {
      const escalationResponse = await triggerEscalationWebhook(payload);
      if (escalationResponse.success) {
        await prisma.activity.create({
          data: {
            userId: systemUser.id,
            ticketId: ticket.id,
            action: "High Priority Escalated: Alert sent to On-Call",
          },
        });
      }
    }

    if (ticket.sentiment === TicketSentiment.NEGATIVE) {
      const csResponse = await triggerNegativeSentimentWebhook(payload);
      if (csResponse.success) {
        await prisma.activity.create({
          data: {
            userId: systemUser.id,
            ticketId: ticket.id,
            action: "Negative Sentiment Alert: Customer success team notified",
          },
        });
      }
    }

    // G. Formulate response with the generated ticket ID
    const escalationReplyText = `${aiResult.replyMessage}\n\nTicket ID: #${ticket.id}`;
    await sendWhatsAppMessage(phoneNumber, escalationReplyText, conversation.id);
    return escalationReplyText;
  }

  // 6. Conversational Flow (No Escalation needed)
  await sendWhatsAppMessage(phoneNumber, aiResult.replyMessage, conversation.id);
  return aiResult.replyMessage;
}
