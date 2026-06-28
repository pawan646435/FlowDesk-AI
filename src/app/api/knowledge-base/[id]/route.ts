import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !session.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const document = await prisma.knowledgeDocument.findUnique({
      where: { id },
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
  } catch (error: any) {
    console.error("[Knowledge DELETE API] Error deleting document:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
