import { NextRequest, NextResponse } from "next/server";
import { getVerifiedSession } from "@/lib/session";
import prisma from "@/lib/prisma";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // MULTI_TENANCY_DESIGN.md §3: findUnique on id alone let any authenticated user from
    // any org delete any other org's document just by guessing/observing its id. Adding
    // organizationId to the filter means this can no longer be findUnique (id alone is no
    // longer the sole match condition) — findFirst enforces the same ownership check.
    const document = await prisma.knowledgeDocument.findFirst({
      where: { id, organizationId: session.user.organizationId },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Cascade delete automatically deletes associated chunks
    await prisma.knowledgeDocument.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: `Document "${document.title}" and all associated index chunks successfully deleted.`,
    });
  } catch (error) {
    console.error("[Knowledge DELETE API] Error deleting document:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
