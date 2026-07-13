import { NextRequest, NextResponse } from "next/server";
import { recoverStuckDocuments } from "@/services/knowledge.service";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recoveredCount = await recoverStuckDocuments();
    return NextResponse.json({
      success: true,
      message: `Stuck document recovery check completed. Recovered ${recoveredCount} documents.`,
      recoveredCount,
    });
  } catch (error) {
    console.error("[Knowledge Recovery API] Error during stuck document recovery:", error);
    const message = error instanceof Error ? error.message : "Stuck document recovery failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
