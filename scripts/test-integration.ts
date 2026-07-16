import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { createTicket } from "../src/services/ticket.service";

dotenv.config();

const prisma = new PrismaClient();

async function runTest() {
  console.log("=== FlowDesk AI Integration Test ===");

  // 1. Fetch first user in the database
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("Error: No users found in database. Please register/log in via browser first.");
    process.exit(1);
  }
  if (!user.organizationId) {
    console.error("Error: User has no organizationId. Sign in and create/join an organization first.");
    process.exit(1);
  }

  console.log(`Found active user: ${user.name} (${user.email})`);
  console.log("Creating test ticket with critical billing contents...");

  // 2. Trigger ticket creation (which runs Gemini AI & calls n8n webhooks)
  const ticket = await createTicket(user.id, user.organizationId, {
    title: "Urgent: credit card charged twice",
    description: "I checked my billing statement today and noticed that my credit card was charged twice for the same transaction. I want an immediate refund of the duplicate charge. Please help!",
  });

  console.log("\n=== Test Ticket Created Successfully ===");
  console.log(`Ticket ID: ${ticket.id}`);
  console.log(`Title:     ${ticket.title}`);
  console.log(`Status:    ${ticket.status}`);
  console.log(`Category:  ${ticket.category} (Expected: BILLING or REFUND)`);
  console.log(`Priority:  ${ticket.priority} (Expected: HIGH)`);
  console.log(`Sentiment: ${ticket.sentiment} (Expected: NEGATIVE)`);
  console.log(`AI Draft Suggested Reply:\n"${ticket.suggestedReply}"`);

  // 3. Fetch activity logs created for this ticket
  const activities = await prisma.activity.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "asc" },
  });

  console.log("\n=== Generated Activity Timeline ===");
  activities.forEach((act, idx) => {
    console.log(`${idx + 1}. [${act.createdAt.toLocaleTimeString()}] ${act.action}`);
  });

  console.log("\n=== Test Completed successfully! ===");
}

runTest()
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
