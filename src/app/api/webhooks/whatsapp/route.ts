import { NextResponse } from "next/server";
import { handleIncomingWhatsAppMessage } from "@/services/whatsapp.service";
import crypto from "crypto";

// Bounded in-memory cache for message deduplication
const processedMessageIds = new Set<string>();
const processedMessageIdTimeline: string[] = [];
const MAX_CACHE_SIZE = 2000;

function isDuplicateMessage(messageId: string): boolean {
  if (processedMessageIds.has(messageId)) {
    return true;
  }
  processedMessageIds.add(messageId);
  processedMessageIdTimeline.push(messageId);
  
  if (processedMessageIdTimeline.length > MAX_CACHE_SIZE) {
    const oldest = processedMessageIdTimeline.shift();
    if (oldest) processedMessageIds.delete(oldest);
  }
  return false;
}

function verifySignature(payloadText: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET || "";
  if (!appSecret) return false;
  if (!signatureHeader) return false;
  
  const signature = signatureHeader.replace("sha256=", "");
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(payloadText)
    .digest("hex");
    
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

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
    console.log("[WhatsApp Webhook] [INFO] Webhook verified successfully.");
    return new Response(challenge, { status: 200 });
  }

  console.warn("[WhatsApp Webhook] [WARN] Webhook verification failed. Tokens mismatch.");
  return new Response("Forbidden", { status: 403 });
}

/**
 * POST - WhatsApp Webhook Event Handler
 * Receives incoming messages from Meta API or the local Web Simulator.
 */
export async function POST(request: Request) {
  try {
    const signatureHeader = request.headers.get("x-hub-signature-256");
    const rawBody = await request.text();
    
    // 1. Verify signature
    if (signatureHeader && !verifySignature(rawBody, signatureHeader)) {
      console.warn("[WhatsApp Webhook] [ERROR] Signature verification failed.");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    console.log("[WhatsApp Webhook] [INFO] Received event payload:", JSON.stringify(body, null, 2));

    let phoneNumber = "";
    let customerName = "WhatsApp User";
    let text = "";
    let messageId = "";
    let isSimulator = false;

    // 2. Simulator Interface Support: Check for direct simplified JSON fields
    if (body.phoneNumber && body.text) {
      phoneNumber = body.phoneNumber;
      customerName = body.customerName || "WhatsApp User";
      text = body.text;
      isSimulator = true;
    } 
    // 3. Standard Meta Cloud API webhook parsing
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
        messageId = message.id;
      }
    }

    // Ignore event if it doesn't contain text body (e.g. read receipts, delivery updates)
    if (!phoneNumber || !text) {
      return NextResponse.json({ success: true, message: "Ignored message delivery status update." });
    }

    // If it's a Meta webhook request but signature header is missing and WHATSAPP_APP_SECRET is not mock, reject it
    if (!isSimulator && !signatureHeader && process.env.WHATSAPP_APP_SECRET !== "mock_secret_key" && process.env.NODE_ENV === "production") {
      console.warn("[WhatsApp Webhook] [ERROR] Missing X-Hub-Signature-256 header in production.");
      return NextResponse.json({ error: "Missing signature header" }, { status: 401 });
    }

    // 4. Duplicate message checking for Meta requests
    if (messageId && isDuplicateMessage(messageId)) {
      console.log(`[WhatsApp Webhook] [INFO] Duplicate message detected (id: ${messageId}). Acknowledging with 200 OK.`);
      return NextResponse.json({ success: true, message: "Duplicate message ignored." });
    }

    // 5. Execution branching:
    // Simulator requests run synchronously so the simulator page gets the reply in the HTTP response.
    if (isSimulator) {
      const reply = await handleIncomingWhatsAppMessage(phoneNumber, customerName, text);
      return NextResponse.json({ success: true, reply });
    } 
    // Meta requests run asynchronously to respond immediately within Meta's 5s timeout.
    else {
      console.log(`[WhatsApp Webhook] [INFO] Spawning background worker for message processing from ${phoneNumber}`);
      
      const nextRequest = request as any;
      const processPromise = handleIncomingWhatsAppMessage(phoneNumber, customerName, text)
        .then((reply) => {
          console.log(`[WhatsApp Webhook] [INFO] Background worker successfully completed. Reply sent: "${reply}"`);
        })
        .catch((error) => {
          console.error("[WhatsApp Webhook] [ERROR] Background worker execution failed:", error);
        });

      if (typeof nextRequest.waitUntil === "function") {
        nextRequest.waitUntil(processPromise);
      }

      return NextResponse.json({ success: true, message: "Webhook received and processing in background." });
    }
  } catch (error: any) {
    console.error("[WhatsApp Webhook] [ERROR] Internal server error handling event:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
