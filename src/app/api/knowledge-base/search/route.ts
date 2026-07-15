import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateEmbedding, searchSimilarity } from "@/services/rag.service";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { query } = await req.json();

    if (!query || query.trim() === "") {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const queryEmbedding = await generateEmbedding(query);
    const results = await searchSimilarity(queryEmbedding, session.user.organizationId, 5, 0.5); // lower threshold for manual testing UI

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("[Search API] Search error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
