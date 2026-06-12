import { NextResponse } from "next/server";
import { handleIncomingWhatsAppMessage } from "@/services/whatsapp.service";

/**
 * GET - WhatsApp Webhook Verification
 * Used by Meta Cloud API to verify endpoint authenticity.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "flowdesk_verify_token";

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[WhatsApp Webhook] Webhook verified successfully.");
    return new Response(challenge, { status: 200 });
  }

  console.warn("[WhatsApp Webhook] Webhook verification failed. Tokens mismatch.");
  return new Response("Forbidden", { status: 403 });
}

/**
 * POST - WhatsApp Webhook Event Handler
 * Receives incoming messages from Meta API or the local Web Simulator.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log("[WhatsApp Webhook] Received event payload:", JSON.stringify(body, null, 2));

    let phoneNumber = "";
    let customerName = "WhatsApp User";
    let text = "";

    // 1. Simulator Interface Support: Check for direct simplified JSON fields
    if (body.phoneNumber && body.text) {
      phoneNumber = body.phoneNumber;
      customerName = body.customerName || "WhatsApp User";
      text = body.text;
    } 
    // 2. Standard Meta Cloud API webhook parsing
    else {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      // We only respond to text messages to prevent media/location handler loops
      if (message && message.type === "text") {
        phoneNumber = message.from;
        customerName = contact?.profile?.name || "WhatsApp User";
        text = message.text.body;
      }
    }

    // Ignore event if it doesn't contain text body (e.g. read receipts, delivery updates)
    if (!phoneNumber || !text) {
      return NextResponse.json({ success: true, message: "Ignored message delivery status update." });
    }

    // 3. Process the message through the stateful WhatsApp support manager
    const reply = await handleIncomingWhatsAppMessage(phoneNumber, customerName, text);

    return NextResponse.json({ success: true, reply });
  } catch (error: any) {
    console.error("[WhatsApp Webhook] Internal server error handling event:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
