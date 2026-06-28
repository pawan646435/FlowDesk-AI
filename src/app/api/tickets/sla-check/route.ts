import { NextResponse } from "next/server";
import { checkSLABreaches } from "@/services/sla.service";

export async function GET() {
  try {
    const breachedCount = await checkSLABreaches();
    return NextResponse.json({
      success: true,
      message: `SLA monitoring check completed. Processed ${breachedCount} breached tickets.`,
      breachedCount,
    });
  } catch (error: any) {
    console.error("[SLA API] Error during SLA checks:", error);
    return NextResponse.json(
      { success: false, error: error.message || "SLA evaluation failed" },
      { status: 500 }
    );
  }
}
