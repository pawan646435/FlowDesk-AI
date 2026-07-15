import prisma from "@/lib/prisma";
import { TicketStatus, TicketPriority, TicketCategory, TicketSentiment, TicketSource } from "@prisma/client";
import { analyzeTicket } from "@/services/gemini.service";
import { triggerNewTicketWebhook, triggerEscalationWebhook, triggerNegativeSentimentWebhook, triggerResolutionWebhook, WebhookPayload } from "@/services/n8n.service";

export async function createTicket(userId: string, organizationId: string, data: { title: string; description: string; isHighPriority?: boolean }) {
  // 1. Trigger AI classification prior to database transaction
  let aiResult = null;
  try {
    aiResult = await analyzeTicket(data.title, data.description);
  } catch (err) {
    console.error("Gemini analysis failed during ticket creation:", err);
  }

  // 2. Persist the ticket and core activities sequentially
  console.log(`[DB Transaction Audit] Starting sequential database operations for ticket creation...`);
  const dbStartTime = Date.now();

  const userPriority = data.isHighPriority ? TicketPriority.HIGH : TicketPriority.LOW;
  const aiPriority = (aiResult?.priority as TicketPriority) || TicketPriority.LOW;
  const { calculateSLADeadlines } = await import("@/services/sla.service");
  const sla = calculateSLADeadlines(aiPriority);

  const ticket = await prisma.ticket.create({
    data: {
      title: data.title,
      description: data.description,
      userId,
      organizationId,
      status: TicketStatus.OPEN,
      category: aiResult?.category as TicketCategory | null,
      priority: aiPriority,
      userPriority: userPriority,
      aiPriority: aiPriority,
      sentiment: aiResult?.sentiment as TicketSentiment | null,
      suggestedReply: aiResult?.suggestedReply || null,
      aiSummary: aiResult?.aiSummary || null,
      keyIssues: aiResult?.keyIssues || null,
      recommendedTeam: aiResult?.recommendedTeam || null,
      firstResponseDueAt: sla.firstResponseDueAt,
      resolutionDueAt: sla.resolutionDueAt,
    },
  });

  // Log Creation Activity
  await prisma.activity.create({
    data: {
      userId,
      organizationId,
      ticketId: ticket.id,
      action: `Created ticket: "${ticket.title}"`,
    },
  });

  // Log AI Analysis Completion Activity
  if (aiResult) {
    await prisma.activity.create({
      data: {
        userId,
        organizationId,
        ticketId: ticket.id,
        action: `AI Analysis Completed: Category=${aiResult.category}, Priority=${aiResult.priority}, Sentiment=${aiResult.sentiment}`,
      },
    });
  }

  console.log(`[DB Transaction Audit] Ticket creation database operations completed in ${Date.now() - dbStartTime}ms.`);

  // 3. Trigger n8n webhook actions (outside transaction to prevent database connection timeouts)
  const payload = {
    ticketId: ticket.id,
    title: ticket.title,
    category: (ticket.category || "GENERAL_INQUIRY") as "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT" | "ACCOUNT_ACCESS" | "SUBSCRIPTION" | "GENERAL_INQUIRY",
    priority: (ticket.priority || "LOW") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  };

  // Trigger n8n Automation Webhooks asynchronously in the background
  (async () => {
    try {
      const newTicketResponse = await triggerNewTicketWebhook(organizationId, payload);
      if (newTicketResponse.success) {
        await prisma.activity.create({
          data: {
            userId,
            organizationId,
            ticketId: ticket.id,
            action: "Workflow Triggered: New Ticket Automation",
          },
        });
      }
    } catch (err) {
      console.error("[n8n Integration] Failed to trigger New Ticket webhook:", err);
    }

    // Trigger Escalation Webhook if Priority is High or Critical
    if (ticket.priority === TicketPriority.HIGH || ticket.priority === TicketPriority.CRITICAL) {
      try {
        const escalationResponse = await triggerEscalationWebhook(organizationId, payload);
        if (escalationResponse.success) {
          await prisma.activity.create({
            data: {
              userId,
              organizationId,
              ticketId: ticket.id,
              action: "High Priority Escalated: Alert sent to On-Call",
            },
          });
        }
      } catch (err) {
        console.error("[n8n Integration] Failed to trigger Escalation webhook:", err);
      }
    }

    // Trigger CS webhook if Sentiment is Negative
    if (ticket.sentiment === TicketSentiment.NEGATIVE) {
      try {
        const csResponse = await triggerNegativeSentimentWebhook(organizationId, payload);
        if (csResponse.success) {
          await prisma.activity.create({
            data: {
              userId,
              organizationId,
              ticketId: ticket.id,
              action: "Negative Sentiment Alert: Customer success team notified",
            },
          });
        }
      } catch (err) {
        console.error("[n8n Integration] Failed to trigger Negative Sentiment webhook:", err);
      }
    }
  })();

  return ticket;
}

export async function getTickets(organizationId: string, status?: TicketStatus) {
  return prisma.ticket.findMany({
    where: {
      organizationId,
      ...(status ? { status } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTicketById(organizationId: string, ticketId: string) {
  return prisma.ticket.findFirst({
    where: {
      id: ticketId,
      organizationId,
    },
    include: {
      activities: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function updateTicketStatus(userId: string, organizationId: string, ticketId: string, status: TicketStatus) {
  console.log(`[DB Transaction Audit] Starting sequential database operations for status update...`);
  const dbStartTime = Date.now();

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, organizationId },
  });

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const isResponseMet = status === TicketStatus.IN_PROGRESS || status === TicketStatus.RESOLVED;
  const updatedTicket = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status,
      ...(isResponseMet ? { firstResponseMet: true } : {})
    },
  });

  await prisma.activity.create({
    data: {
      userId,
      organizationId,
      ticketId,
      action: `Changed status of "${ticket.title}" to ${status}`,
    },
  });

  if (status === TicketStatus.RESOLVED) {
    // Trigger Resolution Webhook asynchronously in the background
    (async () => {
      try {
        const payload = {
          ticketId: updatedTicket.id,
          title: updatedTicket.title,
          category: (updatedTicket.category || "GENERAL_INQUIRY") as WebhookPayload["category"],
          priority: (updatedTicket.priority || "LOW") as WebhookPayload["priority"],
        };
        const resolutionResponse = await triggerResolutionWebhook(organizationId, payload);
        if (resolutionResponse.success) {
          await prisma.activity.create({
            data: {
              userId,
              organizationId,
              ticketId,
              action: "Workflow Triggered: Ticket Resolution Automation",
            },
          });
        }
      } catch (err) {
        console.error("Failed to trigger ticket resolution webhook:", err);
      }
    })();
  }

  // Check for associated WhatsApp conversation and dispatch event-driven updates
  try {
    const whatsAppConv = await prisma.whatsAppConversation.findFirst({
      where: { ticketId: ticketId, organizationId }
    });

    if (whatsAppConv) {
      const { sendWhatsAppMessage } = await import("@/services/whatsapp.service");
      let messageText = `Update: Your ticket #${ticketId} ("${ticket.title}") status has been updated to ${status}.`;
      
      if (status === TicketStatus.RESOLVED) {
        messageText = `Great news! Your ticket #${ticketId} ("${ticket.title}") has been resolved by our support team. If you have any further questions, feel free to send a message here. Thank you!`;
        
        // Mark WhatsApp conversation as RESOLVED so future messages start a fresh session
        await prisma.whatsAppConversation.update({
          where: { id: whatsAppConv.id },
          data: { status: "RESOLVED" }
        });
      } else if (status === TicketStatus.IN_PROGRESS) {
        messageText = `Update: Our engineering team is now actively working on your ticket #${ticketId} ("${ticket.title}"). We will keep you updated on progress.`;
      }

      await sendWhatsAppMessage(whatsAppConv.phoneNumber, organizationId, messageText, whatsAppConv.id);
    }
  } catch (whatsappErr) {
    console.error("Failed to send WhatsApp status update notification:", whatsappErr);
  }

  console.log(`[DB Transaction Audit] Status update database operations completed in ${Date.now() - dbStartTime}ms.`);
  return updatedTicket;
}

export async function getTicketStats(organizationId: string) {
  const [
    statusStats,
    slaBreachedStats,
    categoryStats,
    sentimentStats,
    whatsAppConversationCount,
    whatsAppTicketsCount,
    webTicketsCount
  ] = await Promise.all([
    // Fetch status groupings
    prisma.ticket.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { id: true },
    }),
    // Fetch active SLA breached count (exclude resolved tickets)
    prisma.ticket.count({
      where: {
        organizationId,
        slaBreached: true,
        status: { not: TicketStatus.RESOLVED },
      },
    }),
    // Fetch category breakdown
    prisma.ticket.groupBy({
      by: ['category'],
      where: {
        organizationId,
        category: { not: null },
      },
      _count: { id: true },
    }),
    // Fetch sentiment breakdown
    prisma.ticket.groupBy({
      by: ['sentiment'],
      where: {
        organizationId,
        sentiment: { not: null },
      },
      _count: { id: true },
    }),
    // WhatsApp session statistics
    prisma.whatsAppConversation.count({ where: { organizationId } }),
    prisma.ticket.count({
      where: { organizationId, source: TicketSource.WHATSAPP }
    }),
    prisma.ticket.count({
      where: { organizationId, source: TicketSource.WEB }
    })
  ]);

  let total = 0;
  let open = 0;
  let inProgress = 0;
  let resolved = 0;

  statusStats.forEach((stat) => {
    const count = stat._count.id;
    total += count;
    if (stat.status === TicketStatus.OPEN) open += count;
    if (stat.status === TicketStatus.IN_PROGRESS) inProgress += count;
    if (stat.status === TicketStatus.RESOLVED) resolved += count;
  });

  const categories = categoryStats.map((c) => ({
    category: c.category as TicketCategory,
    count: c._count.id,
  }));

  const sentiments = sentimentStats.map((s) => ({
    sentiment: s.sentiment as TicketSentiment,
    count: s._count.id,
  }));

  const { getSLADashboardStats } = await import("@/services/sla.service");
  const slaStats = await getSLADashboardStats(organizationId);

  return {
    total,
    open,
    inProgress,
    resolved,
    slaBreachedCount: slaBreachedStats,
    categories,
    sentiments,
    whatsAppConversationCount,
    whatsAppTicketsCount,
    webTicketsCount,
    sla: slaStats
  };
}

export async function getQueueTickets(organizationId: string) {
  return prisma.ticket.findMany({
    where: {
      organizationId,
      status: { not: TicketStatus.RESOLVED },
    },
    include: {
      user: true,
    },
    orderBy: { createdAt: "desc" },
  });
}


