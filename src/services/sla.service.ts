import prisma from "@/lib/prisma";
import { TicketPriority, TicketStatus } from "@prisma/client";
import { triggerSlaBreachWebhook, getOrgWebhookConfigsByOrgIds } from "./n8n.service";

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

  // Batch-fetch webhook configs for every org represented among the candidates, once,
  // instead of one OrganizationWebhookConfig lookup per ticket inside the loop below —
  // the sweep is deliberately global (per §7) and commonly spans many orgs in one run.
  const candidateOrgIds = breachedTickets
    .map((t) => t.organizationId)
    .filter((id): id is string => id !== null);
  const webhookConfigsByOrgId = await getOrgWebhookConfigsByOrgIds(candidateOrgIds);

  let claimedCount = 0;
  const claimedActivities: { userId: string; organizationId: string | null; ticketId: string; action: string }[] = [];

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

    // Queue system log activity for a single batched createMany after the loop, rather
    // than one activity.create per ticket. organizationId comes straight off the ticket
    // row already fetched by the (deliberately global, per §7) sweep above — no scoping
    // is added to the sweep's own query, only to the Activity row it writes.
    claimedActivities.push({
      userId: ticket.userId,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      action: `SLA BREACHED: Ticket passed target deadline by ${breachDurationMin} minutes.`,
    });

    // Trigger n8n webhook using the pre-fetched config map. A null organizationId
    // (pre-backfill legacy ticket) has no OrganizationWebhookConfig to look up, so skip
    // cleanly rather than error — same outcome as an org that simply hasn't configured
    // this webhook.
    if (ticket.organizationId) {
      try {
        const customerName = ticket.whatsAppConversation?.customerName || ticket.user.name || "System User";
        await triggerSlaBreachWebhook(webhookConfigsByOrgId.get(ticket.organizationId) ?? null, {
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

  if (claimedActivities.length > 0) {
    await prisma.activity.createMany({ data: claimedActivities });
  }

  return claimedCount;
}

/**
 * Aggregates SLA statistics for the support dashboard metrics.
 */
export async function getSLADashboardStats(organizationId: string) {
  const [
    activeSlasCount,
    breachedSlasCount,
    resolvedCount,
    resolvedCompliantCount,
  ] = await Promise.all([
    // Active SLAs (tickets under SLA monitoring that are not resolved)
    prisma.ticket.count({
      where: {
        organizationId,
        status: { not: TicketStatus.RESOLVED },
        firstResponseDueAt: { not: null },
      },
    }),
    // Breached active SLAs
    prisma.ticket.count({
      where: {
        organizationId,
        status: { not: TicketStatus.RESOLVED },
        slaBreached: true,
      },
    }),
    // Total resolved tickets
    prisma.ticket.count({
      where: {
        organizationId,
        status: TicketStatus.RESOLVED,
      },
    }),
    // Compliant resolved tickets (resolved without breaching)
    prisma.ticket.count({
      where: {
        organizationId,
        status: TicketStatus.RESOLVED,
        slaBreached: false,
      },
    }),
  ]);

  const complianceRate = resolvedCount > 0
    ? Math.round((resolvedCompliantCount / resolvedCount) * 100)
    : 100;

  // Average Response Time for responded tickets — computed at the database level. For
  // each ticket with firstResponseMet: true, "first response" is the earliest Activity
  // whose action isn't one of the three system-generated prefixes (ticket creation, AI
  // analysis, workflow-trigger logging); response time is that activity's createdAt minus
  // the ticket's own createdAt, averaged in minutes across every ticket that has such an
  // activity at all. Previously this fetched every matching ticket's *entire* activities
  // relation into memory (DB audit + dashboard Suspense investigation both flagged this as
  // the single slowest query on the dashboard) just to do this same MIN-then-average
  // reduction in JS — the LATERAL join below does the identical per-ticket "earliest
  // qualifying activity" lookup Postgres-side and returns only the final numbers.
  const [responseTimeResult] = await prisma.$queryRaw<{ avgMinutes: number | null; respondedCount: bigint }[]>`
    SELECT
      AVG(EXTRACT(EPOCH FROM (first_response."firstResponseAt" - t."createdAt")) / 60) AS "avgMinutes",
      COUNT(*) AS "respondedCount"
    FROM "Ticket" t
    INNER JOIN LATERAL (
      SELECT MIN(a."createdAt") AS "firstResponseAt"
      FROM "Activity" a
      WHERE a."ticketId" = t.id
        AND a.action NOT LIKE 'Created ticket%'
        AND a.action NOT LIKE 'AI Analysis%'
        AND a.action NOT LIKE 'Workflow Triggered%'
    ) first_response ON first_response."firstResponseAt" IS NOT NULL
    WHERE t."organizationId" = ${organizationId}
      AND t."firstResponseMet" = true
  `;

  const averageResponseTime = responseTimeResult?.avgMinutes != null
    ? Math.round(Number(responseTimeResult.avgMinutes))
    : 0; // in minutes

  return {
    activeSlas: activeSlasCount,
    breachedSlas: breachedSlasCount,
    complianceRate,
    averageResponseTime, // minutes
  };
}
