import prisma from "@/lib/prisma";

// Note (MULTI_TENANCY_DESIGN.md §3): no callers found anywhere in src/ or scripts/ —
// every actual activity-logging call site inlines prisma.activity.create directly
// instead of using this helper. Fixed for consistency rather than removed, since it's
// a small, correctly-shaped function that could legitimately be used going forward;
// removing unused-but-harmless exports is a separate cleanup, not part of this scoping pass.
export async function createActivity(userId: string, organizationId: string, ticketId: string, action: string) {
  return prisma.activity.create({
    data: {
      userId,
      organizationId,
      ticketId,
      action,
    },
  });
}

export async function getRecentActivities(organizationId: string, limit = 10) {
  return prisma.activity.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      ticket: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });
}
