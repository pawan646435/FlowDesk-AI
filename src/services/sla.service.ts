import prisma from "@/lib/prisma";
import { TicketPriority, TicketStatus } from "@prisma/client";
import { triggerSlaBreachWebhook } from "./n8n.service";

/**
 * Calculates response and resolution SLA deadlines based on priority.
 */
export function calculateSLADeadlines(priority: TicketPriority) {
  const now = new Date();
  let responseMinutes = 4 * 60; // default LOW: 4 hours
  let resolutionMinutes = 24 * 60; // default LOW: 24 hours

  if (priority === TicketPriority.CRITICAL) {
    responseMinutes = 15; // 15 mins
    resolutionMinutes = 60; // 1 hour
  } else if (priority === TicketPriority.HIGH) {
    responseMinutes = 15; // 15 mins
    resolutionMinutes = 60; // 1 hour
  } else if (priority === TicketPriority.MEDIUM) {
    responseMinutes = 60; // 1 hour
    resolutionMinutes = 4 * 60; // 4 hours
  }

  const firstResponseDueAt = new Date(now.getTime() + responseMinutes * 60 * 1000);
  const resolutionDueAt = new Date(now.getTime() + resolutionMinutes * 60 * 1000);

  return { firstResponseDueAt, resolutionDueAt };
}

/**
 * Checks all active tickets for SLA breaches. Sets breach flags and triggers notifications.
 */
export async function checkSLABreaches() {
  const now = new Date();

  // Find tickets that are not resolved, not yet marked as breached, and have passed due dates
  const breachedTickets = await prisma.ticket.findMany({
    where: {
      status: { not: TicketStatus.RESOLVED },
      slaBreached: false,
      OR: [
        {
          firstResponseMet: { not: true },
          firstResponseDueAt: { lt: now },
        },
        {
          resolutionDueAt: { lt: now },
        },
      ],
    },
    include: {
      user: true,
      whatsAppConversation: true,
    },
  });

  console.log(`[SLA Monitor] Found ${breachedTickets.length} candidate breached tickets.`);

  let claimedCount = 0;

  for (const ticket of breachedTickets) {
    // Determine which limit was breached (first response or resolution)
    const dueTime = !ticket.firstResponseMet && ticket.firstResponseDueAt && ticket.firstResponseDueAt < now
      ? ticket.firstResponseDueAt
      : ticket.resolutionDueAt || now;

    const breachDurationMs = now.getTime() - dueTime.getTime();
    const breachDurationMin = Math.max(0, Math.round(breachDurationMs / 60000));

    // Atomically claim this breach: the WHERE clause re-checks slaBreached at write time,
    // so if a concurrent/overlapping invocation already claimed this ticket between our
    // findMany() above and this update, `count` comes back 0 and we skip it — preventing
    // duplicate Activity rows and duplicate n8n webhook fires for the same breach.
    const claim = await prisma.ticket.updateMany({
      where: { id: ticket.id, slaBreached: false },
      data: {
        slaBreached: true,
        breachedAt: now,
      },
    });

    if (claim.count === 0) {
      console.log(`[SLA Monitor] Ticket ${ticket.id} already claimed by a concurrent run, skipping.`);
      continue;
    }

    claimedCount++;

    // Create system log activity. organizationId comes straight off the ticket row
    // already fetched by the (deliberately global, per §7) sweep above — no scoping
    // is added to the sweep's own query, only to the Activity row it writes.
    await prisma.activity.create({
      data: {
        userId: ticket.userId,
        organizationId: ticket.organizationId,
        ticketId: ticket.id,
        action: `SLA BREACHED: Ticket passed target deadline by ${breachDurationMin} minutes.`,
      },
    });

    // Trigger n8n webhook. A null organizationId (pre-backfill legacy ticket) has no
    // OrganizationWebhookConfig to look up, so skip cleanly rather than error — same
    // outcome as an org that simply hasn't configured this webhook.
    if (ticket.organizationId) {
      try {
        const customerName = ticket.whatsAppConversation?.customerName || ticket.user.name || "System User";
        await triggerSlaBreachWebhook(ticket.organizationId, {
          ticketId: ticket.id,
          priority: ticket.priority || TicketPriority.LOW,
          category: ticket.category || "GENERAL_INQUIRY",
          customerName,
          breachDuration: `${breachDurationMin} minutes`,
        });
      } catch (webhookErr) {
        console.error(`[SLA Monitor] Failed to trigger SLA breach webhook for ticket ${ticket.id}:`, webhookErr);
      }
    } else {
      console.log(`[SLA Monitor] Ticket ${ticket.id} has no organizationId, skipping SLA breach webhook.`);
    }
  }

  return claimedCount;
}

/**
 * Aggregates SLA statistics for the support dashboard metrics.
 */
export async function getSLADashboardStats(userId: string, organizationId: string) {
  const [
    activeSlasCount,
    breachedSlasCount,
    resolvedCount,
    resolvedCompliantCount,
  ] = await Promise.all([
    // Active SLAs (tickets under SLA monitoring that are not resolved)
    prisma.ticket.count({
      where: {
        userId,
        organizationId,
        status: { not: TicketStatus.RESOLVED },
        firstResponseDueAt: { not: null },
      },
    }),
    // Breached active SLAs
    prisma.ticket.count({
      where: {
        userId,
        organizationId,
        status: { not: TicketStatus.RESOLVED },
        slaBreached: true,
      },
    }),
    // Total resolved tickets
    prisma.ticket.count({
      where: {
        userId,
        organizationId,
        status: TicketStatus.RESOLVED,
      },
    }),
    // Compliant resolved tickets (resolved without breaching)
    prisma.ticket.count({
      where: {
        userId,
        organizationId,
        status: TicketStatus.RESOLVED,
        slaBreached: false,
      },
    }),
  ]);

  const complianceRate = resolvedCount > 0
    ? Math.round((resolvedCompliantCount / resolvedCount) * 100)
    : 100;

  // Calculate Average Response Time for responded tickets
  const ticketsWithResponse = await prisma.ticket.findMany({
    where: {
      userId,
      organizationId,
      firstResponseMet: true,
    },
    include: {
      activities: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  let totalMinutes = 0;
  let respondedCount = 0;

  for (const ticket of ticketsWithResponse) {
    const firstResponse = ticket.activities.find(
      (a) =>
        !a.action.startsWith("Created ticket") &&
        !a.action.startsWith("AI Analysis") &&
        !a.action.startsWith("Workflow Triggered")
    );

    if (firstResponse) {
      const diffMs = firstResponse.createdAt.getTime() - ticket.createdAt.getTime();
      totalMinutes += diffMs / (60 * 1000);
      respondedCount++;
    }
  }

  const averageResponseTime = respondedCount > 0
    ? Math.round(totalMinutes / respondedCount)
    : 0; // in minutes

  return {
    activeSlas: activeSlasCount,
    breachedSlas: breachedSlasCount,
    complianceRate,
    averageResponseTime, // minutes
  };
}
