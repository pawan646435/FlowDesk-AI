import { NextResponse } from "next/server";
import { handleIncomingWhatsAppMessage } from "@/services/whatsapp.service";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import crypto from "crypto";

// Meta retries undelivered/failed webhooks for up to 7 days (at-least-once delivery),
// so claimed message IDs must outlive that window before it's safe to prune them.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// Cheap opportunistic cleanup: run on a small fraction of requests instead of on a
// dedicated schedule, so this stays self-contained without new cron infrastructure.
const CLEANUP_SAMPLE_RATE = 0.01;

/**
 * Durably claims a Meta message ID via an atomic DB insert. Backed by a unique
 * constraint on ProcessedWebhookEvent.messageId, so this is safe under concurrent
 * retries and survives serverless cold starts (unlike an in-memory cache).
 * Returns true if this is the first time the ID has been claimed (i.e. process it);
 * false if it was already claimed (i.e. a duplicate delivery — skip processing).
 */
async function claimMessageId(messageId: string): Promise<boolean> {
  try {
    await prisma.processedWebhookEvent.create({ data: { messageId } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false;
    }
    // Unexpected DB error: don't silently treat as a duplicate — let the caller
    // fail the request so Meta retries it later instead of us dropping a message.
    throw err;
  }
}

/**
 * Deletes claimed message IDs older than Meta's retry window. Sampled probabilistically
 * per-request rather than run on a schedule, and always dispatched in the background so
 * it never adds latency to the webhook response.
 */
async function cleanupOldProcessedWebhookEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const result = await prisma.processedWebhookEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    console.log(`[WhatsApp Webhook] [INFO] Cleaned up ${result.count} expired processed-webhook-event records.`);
  }
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
  const nextRequest = request as Request & { waitUntil?: (promise: Promise<unknown>) => void };

  // Opportunistic, sampled, non-blocking cleanup of expired dedup records. Dispatched
  // up front so it never sits on the response path regardless of which branch below runs.
  if (Math.random() < CLEANUP_SAMPLE_RATE) {
    const cleanupPromise = cleanupOldProcessedWebhookEvents().catch((err) =>
      console.error("[WhatsApp Webhook] [ERROR] Cleanup of expired processed-webhook-events failed:", err)
    );
    if (typeof nextRequest.waitUntil === "function") {
      nextRequest.waitUntil(cleanupPromise);
    }
  }

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

    // 4. Duplicate message checking for Meta requests (durable, DB-backed claim)
    if (messageId) {
      const isNewMessage = await claimMessageId(messageId);
      if (!isNewMessage) {
        console.log(`[WhatsApp Webhook] [INFO] Duplicate message detected (id: ${messageId}). Acknowledging with 200 OK.`);
        return NextResponse.json({ success: true, message: "Duplicate message ignored." });
      }
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
  } catch (error) {
    console.error("[WhatsApp Webhook] [ERROR] Internal server error handling event:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
