import prisma from "@/lib/prisma";

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
