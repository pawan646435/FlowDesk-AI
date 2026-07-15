import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const DEMO_ORG_SLUG = "demo";
const DEMO_ORG_NAME = "Demo Org";

/**
 * MULTI_TENANCY_DESIGN.md §6 — backfill migration.
 * Standalone, manually-run script (not an automatic migration hook). Steps 1-4 of §6:
 *   1. organizationId columns already added as nullable (schema step, done separately).
 *   2. Create a default org.
 *   3. Backfill every tenant-scoped table's existing NULL organizationId rows, User first.
 *   4. WhatsAppConversation's unique constraint is already fixed at the schema level
 *      (@@unique([organizationId, phoneNumber])) — safe because, pre-backfill, every
 *      row about to be assigned shares the same organizationId (this Demo Org), so
 *      there is only one org's worth of phoneNumber values in play.
 * Step 5 (make organizationId required) is explicitly NOT part of this script — that's
 * a later step, once backfill is confirmed complete across every table.
 */
async function backfill() {
  console.log("====================================================");
  console.log("FlowDesk AI - Multi-Tenancy Backfill (MULTI_TENANCY_DESIGN.md §6)");
  console.log("====================================================");

  // Step 2: create (or reuse, if this script is re-run) the default org.
  let demoOrg = await prisma.organization.findUnique({
    where: { slug: DEMO_ORG_SLUG },
  });

  if (demoOrg) {
    console.log(`\nReusing existing "${demoOrg.name}" (id: ${demoOrg.id}) — script is idempotent.`);
  } else {
    demoOrg = await prisma.organization.create({
      data: { name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG },
    });
    console.log(`\nCreated "${demoOrg.name}" (id: ${demoOrg.id}).`);
  }

  // Step 3: backfill, User first per §6's explicit ordering (auth flow depends on every
  // existing user having an org before anyone can log in post-migration).
  console.log("\nBackfilling organizationId on existing rows...");

  // Note: role is deliberately NOT set here. §6 predates the role concept, and §9.6 only
  // specifies role assignment via the (not-yet-built) invite-consumption jwt callback —
  // it does not say what backfilled/pre-existing users should get. Leaving it null keeps
  // this script strictly to what's specified rather than improvising an unstated default.
  const userResult = await prisma.user.updateMany({
    where: { organizationId: null },
    data: { organizationId: demoOrg.id },
  });
  console.log(`  User:                 ${userResult.count} row(s) updated`);

  const ticketResult = await prisma.ticket.updateMany({
    where: { organizationId: null },
    data: { organizationId: demoOrg.id },
  });
  console.log(`  Ticket:                ${ticketResult.count} row(s) updated`);

  const activityResult = await prisma.activity.updateMany({
    where: { organizationId: null },
    data: { organizationId: demoOrg.id },
  });
  console.log(`  Activity:              ${activityResult.count} row(s) updated`);

  const conversationResult = await prisma.whatsAppConversation.updateMany({
    where: { organizationId: null },
    data: { organizationId: demoOrg.id },
  });
  console.log(`  WhatsAppConversation:  ${conversationResult.count} row(s) updated`);

  const messageResult = await prisma.whatsAppMessage.updateMany({
    where: { organizationId: null },
    data: { organizationId: demoOrg.id },
  });
  console.log(`  WhatsAppMessage:       ${messageResult.count} row(s) updated`);

  const documentResult = await prisma.knowledgeDocument.updateMany({
    where: { organizationId: null },
    data: { organizationId: demoOrg.id },
  });
  console.log(`  KnowledgeDocument:     ${documentResult.count} row(s) updated`);

  const chunkResult = await prisma.documentChunk.updateMany({
    where: { organizationId: null },
    data: { organizationId: demoOrg.id },
  });
  console.log(`  DocumentChunk:         ${chunkResult.count} row(s) updated`);

  // Not backfilled, deliberately: ProcessedWebhookEvent (§1 — cross-org infrastructure,
  // out of scope) and WhatsAppNumberMapping (§5 Option C — brand-new table, no
  // pre-existing rows to backfill, organizationId already required on creation).

  console.log("\nBackfill complete.");
}

backfill()
  .catch((err) => {
    console.error("Backfill failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
