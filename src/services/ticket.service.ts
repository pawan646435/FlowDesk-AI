import prisma from "@/lib/prisma";
import { TicketStatus, TicketPriority, TicketCategory, TicketSentiment } from "@prisma/client";
import { analyzeTicket } from "@/services/gemini.service";
import { triggerNewTicketWebhook, triggerEscalationWebhook } from "@/services/n8n.service";

export async function createTicket(userId: string, data: { title: string; description: string; isHighPriority?: boolean }) {
  // 1. Trigger AI classification prior to database transaction
  let aiResult = null;
  try {
    aiResult = await analyzeTicket(data.title, data.description);
  } catch (err) {
    console.error("Gemini analysis failed during ticket creation:", err);
  }

  // 2. Persist the ticket and core activities inside a database transaction
  const ticket = await prisma.$transaction(async (tx) => {
    const createdTicket = await tx.ticket.create({
      data: {
        title: data.title,
        description: data.description,
        userId,
        status: TicketStatus.OPEN,
        category: aiResult?.category as TicketCategory | null,
        priority: data.isHighPriority ? TicketPriority.HIGH : (aiResult?.priority as TicketPriority | null),
        sentiment: aiResult?.sentiment as TicketSentiment | null,
        suggestedReply: aiResult?.suggestedReply || null,
      },
    });

    // Log Creation Activity
    await tx.activity.create({
      data: {
        userId,
        ticketId: createdTicket.id,
        action: `Created ticket: "${createdTicket.title}"`,
      },
    });

    // Log AI Analysis Completion Activity
    if (aiResult) {
      await tx.activity.create({
        data: {
          userId,
          ticketId: createdTicket.id,
          action: `AI Analysis Completed: Category=${aiResult.category}, Priority=${aiResult.priority}, Sentiment=${aiResult.sentiment}`,
        },
      });
    }

    return createdTicket;
  });

  // 3. Trigger n8n webhook actions (outside transaction to prevent database connection timeouts)
  if (ticket.category && ticket.priority) {
    const payload = {
      ticketId: ticket.id,
      title: ticket.title,
      category: ticket.category as "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT",
      priority: ticket.priority as "LOW" | "MEDIUM" | "HIGH",
    };

    // Trigger New Ticket Webhook
    const newTicketResponse = await triggerNewTicketWebhook(payload);
    if (newTicketResponse.success) {
      await prisma.activity.create({
        data: {
          userId,
          ticketId: ticket.id,
          action: "Workflow Triggered: New Ticket Automation",
        },
      });
    }

    // Trigger Escalation Webhook if Priority is High
    if (ticket.priority === TicketPriority.HIGH) {
      const escalationResponse = await triggerEscalationWebhook(payload);
      if (escalationResponse.success) {
        await prisma.activity.create({
          data: {
            userId,
            ticketId: ticket.id,
            action: "High Priority Escalated: Alert sent to On-Call",
          },
        });
      }
    }
  }

  return ticket;
}

export async function getTickets(userId: string, status?: TicketStatus) {
  return prisma.ticket.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTicketById(userId: string, ticketId: string) {
  return prisma.ticket.findFirst({
    where: {
      id: ticketId,
      userId,
    },
    include: {
      activities: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function updateTicketStatus(userId: string, ticketId: string, status: TicketStatus) {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, userId },
    });

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    const updatedTicket = await tx.ticket.update({
      where: { id: ticketId },
      data: { status },
    });

    await tx.activity.create({
      data: {
        userId,
        ticketId,
        action: `Changed status of "${ticket.title}" to ${status}`,
      },
    });

    return updatedTicket;
  });
}

export async function getTicketStats(userId: string) {
  const [statusStats, priorityStats, categoryStats, sentimentStats] = await Promise.all([
    // Fetch status groupings
    prisma.ticket.groupBy({
      by: ['status'],
      where: { userId },
      _count: { id: true },
    }),
    // Fetch active high priority count (exclude resolved tickets)
    prisma.ticket.count({
      where: {
        userId,
        priority: TicketPriority.HIGH,
        status: { not: TicketStatus.RESOLVED },
      },
    }),
    // Fetch category breakdown
    prisma.ticket.groupBy({
      by: ['category'],
      where: {
        userId,
        category: { not: null },
      },
      _count: { id: true },
    }),
    // Fetch sentiment breakdown
    prisma.ticket.groupBy({
      by: ['sentiment'],
      where: {
        userId,
        sentiment: { not: null },
      },
      _count: { id: true },
    }),
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

  return {
    total,
    open,
    inProgress,
    resolved,
    highPriorityCount: priorityStats,
    categories,
    sentiments,
  };
}
