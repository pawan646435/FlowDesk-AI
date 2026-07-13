import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tickets/[id] - Retrieve ticket status and priority for n8n status check
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: resolvedParams.id },
      select: {
        id: true,
        status: true,
        priority: true,
        slaBreached: true,
        title: true,
        category: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json(ticket);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/tickets/[id] - Mark ticket as escalated / SLA breached and log activity
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    // 1. Fetch current ticket to get user ID
    const currentTicket = await prisma.ticket.findUnique({
      where: { id: resolvedParams.id },
      select: { userId: true, title: true },
    });

    if (!currentTicket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // 2. Update ticket status and log activity sequentially
    const updatedTicket = await prisma.ticket.update({
      where: { id: resolvedParams.id },
      data: {
        slaBreached: true,
        escalatedAt: new Date(),
      },
    });

    await prisma.activity.create({
      data: {
        userId: currentTicket.userId,
        ticketId: resolvedParams.id,
        action: `SLA Breached: Stateful Auto Escalation email dispatched via n8n`,
      },
    });

    return NextResponse.json({ success: true, ticket: updatedTicket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
