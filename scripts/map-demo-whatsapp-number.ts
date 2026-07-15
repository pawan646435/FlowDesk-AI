import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const DEMO_ORG_SLUG = "demo";

/**
 * MULTI_TENANCY_DESIGN.md §5 Option C — maps a real WhatsApp Business phone_number_id
 * to the Demo Org, so the webhook route (src/app/api/webhooks/whatsapp/route.ts) can
 * resolve which organization owns an inbound Meta webhook message. Without a row here,
 * every real (non-simulator) webhook call is intentionally ignored — see verification
 * notes for where that "no mapping found" log line appears.
 *
 * Usage:
 *   npx tsx scripts/map-demo-whatsapp-number.ts <phone_number_id>
 *
 * <phone_number_id> is NOT the WhatsApp phone number itself (not "+1 555 0100") — it's
 * the numeric ID Meta assigns to that number in the developer console. See the chat
 * response for exactly where to find it.
 */
async function mapNumber() {
  const phoneNumberId = process.argv[2];

  if (!phoneNumberId || phoneNumberId.trim() === "") {
    console.error("====================================================");
    console.error("Missing phone_number_id argument.");
    console.error("Usage: npx tsx scripts/map-demo-whatsapp-number.ts <phone_number_id>");
    console.error("====================================================");
    process.exit(1);
  }

  console.log("====================================================");
  console.log("FlowDesk AI - Map WhatsApp Number to Demo Org (MULTI_TENANCY_DESIGN.md §5)");
  console.log("====================================================");

  const demoOrg = await prisma.organization.findUnique({
    where: { slug: DEMO_ORG_SLUG },
  });

  if (!demoOrg) {
    console.error(`\nNo organization with slug "${DEMO_ORG_SLUG}" found. Run scripts/backfill-demo-org.ts first.`);
    process.exit(1);
  }

  console.log(`\nOrganization: "${demoOrg.name}" (id: ${demoOrg.id})`);
  console.log(`phone_number_id: ${phoneNumberId}`);

  // Upsert so re-running with the same id is safe (idempotent), and re-running with a
  // different org later would just repoint the mapping rather than error.
  const mapping = await prisma.whatsAppNumberMapping.upsert({
    where: { phoneNumberId },
    update: { organizationId: demoOrg.id },
    create: { phoneNumberId, organizationId: demoOrg.id },
  });

  console.log(`\nMapping saved: phone_number_id ${mapping.phoneNumberId} -> organization ${demoOrg.name} (${mapping.organizationId})`);
  console.log("\nDone. Real Meta webhook messages arriving on this number will now resolve to this org.");
}

mapNumber()
  .catch((err) => {
    console.error("Mapping failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
