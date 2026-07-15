import fs from "fs";
import path from "path";
import crypto from "crypto";

// 1. Load environment variables from .env manually before importing prisma
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.substring(0, index).trim();
      let value = trimmed.substring(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}
loadEnv();

const TEST_PHONE = "19999999999";
const PORT = process.env.PORT || "3000";
const BASE_URL = `http://localhost:${PORT}`;

function calculateSignature(payloadText: string, appSecret: string): string {
  return "sha256=" + crypto
    .createHmac("sha256", appSecret)
    .update(payloadText)
    .digest("hex");
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("==================================================");
  console.log("🚀 STARTING WHATSAPP PRODUCTION CHANNEL HARDENING INTEGRATION TESTS");
  console.log("==================================================");

  // Dynamically import dependencies after env variables are loaded to bypass hoisting
  const { default: prisma } = await import("@/lib/prisma");
  const { updateTicketStatus } = await import("@/services/ticket.service");
  const { TicketStatus } = await import("@prisma/client");

  // A. Database clean up before running tests
  console.log("\n[Test Setup] Cleaning database records for test phone:", TEST_PHONE);
  const existingConv = await prisma.whatsAppConversation.findFirst({
    where: { phoneNumber: TEST_PHONE }
  });
  if (existingConv) {
    if (existingConv.ticketId) {
      await prisma.activity.deleteMany({ where: { ticketId: existingConv.ticketId } });
      await prisma.ticket.delete({ where: { id: existingConv.ticketId } });
    }
    const stillExists = await prisma.whatsAppConversation.findUnique({
      where: { id: existingConv.id }
    });
    if (stillExists) {
      await prisma.whatsAppConversation.delete({ where: { id: existingConv.id } });
    }
    console.log("[Test Setup] Database cleared successfully.");
  } else {
    console.log("[Test Setup] No existing records found. Skipping database cleanup.");
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET || "mock_secret_key";
  console.log(`[Test Setup] App Secret Loaded: ${appSecret}`);

  // B. Test Simulator Endpoint (Synchronous path)
  console.log("\n[Test 1] Simulating Web Dashboard Simulator request (Synchronous response)...");
  const simulatorPayload = {
    phoneNumber: TEST_PHONE,
    customerName: "Test Customer",
    text: "Hello! I want to check my account billing options."
  };
  
  const simResponse = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(simulatorPayload)
  });

  if (!simResponse.ok) {
    throw new Error(`Simulator request failed with status: ${simResponse.status}`);
  }
  const simData = await simResponse.json();
  console.log("[Test 1 Result] Status:", simResponse.status);
  console.log("[Test 1 Result] Response Payload:", JSON.stringify(simData, null, 2));
  if (!simData.reply) {
    throw new Error("Test 1 Failed: reply field missing in response");
  }

  // C. Test Meta Webhook signature verification & background processing
  console.log("\n[Test 2] Simulating incoming Meta Webhook message (Asynchronous path)...");
  const metaMsgId = "wamid.HBgLMTk5OTk5OTk5OTkVAgASGBQzQjFFQjQ5OEFCMDBCMjg5QjA1M0EzAA==_" + Date.now();
  const metaPayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "mock_entry_id",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550199",
                phone_number_id: "mock"
              },
              contacts: [
                {
                  profile: { name: "Test Customer" },
                  wa_id: TEST_PHONE
                }
              ],
              messages: [
                {
                  from: TEST_PHONE,
                  id: metaMsgId,
                  timestamp: "1676648700",
                  text: {
                    body: "This is critical, my account access is locked and I need immediate support!"
                  },
                  type: "text"
                }
              ]
            },
            field: "messages"
          }
        ]
      }
    ]
  };

  const metaPayloadStr = JSON.stringify(metaPayload);
  const signature = calculateSignature(metaPayloadStr, appSecret);

  const metaResponse = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature
    },
    body: metaPayloadStr
  });

  const metaData = await metaResponse.json();
  console.log("[Test 2 Result] Status:", metaResponse.status);
  console.log("[Test 2 Result] Response Payload:", JSON.stringify(metaData, null, 2));
  if (!metaResponse.ok || !metaData.success) {
    throw new Error("Test 2 Failed: Meta Webhook request rejected");
  }

  // D. Test Duplicate Message Detection (Idempotency)
  console.log("\n[Test 3] Simulating duplicate Meta Webhook request (Idempotency check)...");
  const duplicateResponse = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature
    },
    body: metaPayloadStr
  });
  const duplicateData = await duplicateResponse.json();
  console.log("[Test 3 Result] Status:", duplicateResponse.status);
  console.log("[Test 3 Result] Response Payload:", JSON.stringify(duplicateData, null, 2));
  if (duplicateData.message !== "Duplicate message ignored.") {
    throw new Error("Test 3 Failed: Duplicate webhook was not correctly caught and ignored.");
  }

  // E. Test Webhook Signature Rejection
  console.log("\n[Test 4] Simulating Meta Webhook request with an invalid signature...");
  const metaPayload2 = {
    ...metaPayload,
    entry: [
      {
        ...metaPayload.entry[0],
        changes: [
          {
            ...metaPayload.entry[0].changes[0],
            value: {
              ...metaPayload.entry[0].changes[0].value,
              messages: [
                {
                  ...metaPayload.entry[0].changes[0].value.messages[0],
                  id: metaMsgId + "_new"
                }
              ]
            }
          }
        ]
      }
    ]
  };
  const metaPayload2Str = JSON.stringify(metaPayload2);

  const invalidSigResponse = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": "sha256=invalidsignature12345"
    },
    body: metaPayload2Str
  });
  const invalidSigData = await invalidSigResponse.json();
  console.log("[Test 4 Result] Status:", invalidSigResponse.status);
  console.log("[Test 4 Result] Response Payload:", JSON.stringify(invalidSigData, null, 2));
  if (invalidSigResponse.status !== 401) {
    throw new Error("Test 4 Failed: Request was not rejected with HTTP 401.");
  }

  // F. Verification of async ticket creation
  console.log("\n[Test 5] Checking database for ticket creation by background worker...");
  console.log("Waiting 8 seconds for background Gemini and Prisma worker to complete...");
  await sleep(8000);

  const finalConv = await prisma.whatsAppConversation.findFirst({
    where: { phoneNumber: TEST_PHONE },
    include: { messages: true }
  });

  if (!finalConv) {
    throw new Error("Test 5 Failed: WhatsApp Conversation was not created or persists in DB.");
  }

  console.log("[Test 5 Result] Conversation status:", finalConv.status);
  console.log("[Test 5 Result] Associated Ticket ID:", finalConv.ticketId);
  console.log("[Test 5 Result] Total messages exchanged:", finalConv.messages.length);

  if (finalConv.status !== "ESCALATED" || !finalConv.ticketId) {
    throw new Error("Test 5 Failed: Conversation was not escalated or ticket was not linked.");
  }

  const createdTicket = await prisma.ticket.findFirst({
    where: { id: finalConv.ticketId },
    include: { activities: true }
  });

  if (!createdTicket) {
    throw new Error("Test 5 Failed: Linked ticket record not found in the database.");
  }
  console.log("[Test 5 Result] Ticket Details in Database:");
  console.log("  - Title:", createdTicket.title);
  console.log("  - Priority:", createdTicket.priority);
  console.log("  - Sentiment:", createdTicket.sentiment);
  console.log("  - Category:", createdTicket.category);
  console.log("  - Activities Logged count:", createdTicket.activities.length);

  // G. Test Ticket Resolution Flow (Event-Driven update & session reset)
  console.log("\n[Test 6] Resolving ticket through FlowDesk Dashboard service...");
  // Simulate system/agent user resolving the ticket
  const systemUser = await prisma.user.findFirst();
  if (!systemUser) {
    throw new Error("No agent user in database to resolve ticket.");
  }
  if (!systemUser.organizationId) {
    throw new Error("Agent user has no organizationId. Run scripts/backfill-demo-org.ts first.");
  }

  await updateTicketStatus(systemUser.id, systemUser.organizationId, createdTicket.id, TicketStatus.RESOLVED);
  console.log("[Test 6 Status] Ticket status changed to RESOLVED.");

  // Verify conversation is closed in DB
  const resolvedConv = await prisma.whatsAppConversation.findFirst({
    where: { id: finalConv.id }
  });

  if (!resolvedConv) {
    throw new Error("WhatsApp Conversation not found after status update.");
  }

  console.log("[Test 6 Result] Resolved Conversation status in DB:", resolvedConv.status);
  if (resolvedConv.status !== "RESOLVED") {
    throw new Error("Test 6 Failed: Conversation status did not update to RESOLVED.");
  }

  console.log("\n==================================================");
  console.log("🎉 ALL INTEGRATION AND OPERATION HARDENING TESTS PASSED!");
  console.log("==================================================");
}

runTests()
  .catch((err) => {
    console.error("\n❌ TEST FAILED WITH EXCEPTION:\n", err);
    process.exit(1);
  })
  .finally(async () => {
    // Dynamically import prisma to close connection
    const { default: prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });
