import prisma from "@/lib/prisma";

export async function createActivity(userId: string, ticketId: string, action: string) {
  return prisma.activity.create({
    data: {
      userId,
      ticketId,
      action,
    },
  });
}

export async function getRecentActivities(userId: string, limit = 10) {
  return prisma.activity.findMany({
    where: { userId },
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
