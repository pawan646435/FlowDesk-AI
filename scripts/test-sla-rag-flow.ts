import { PrismaClient, TicketPriority, TicketStatus } from "@prisma/client";
import { calculateSLADeadlines, checkSLABreaches } from "../src/services/sla.service";
import { chunkTextContent } from "../src/services/knowledge.service";
import { generateEmbedding, searchSimilarity } from "../src/services/rag.service";
import { analyzeWhatsAppMessage } from "../src/services/gemini.service";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function runTests() {
  console.log("====================================================");
  console.log("⚡ FLOWDESK AI - SLA & RAG SYSTEM INTEGRATION TEST SUITE");
  console.log("====================================================");

  // Retrieve a test system user for linking records
  let testUser = await prisma.user.findFirst();
  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        name: "Test Engineer",
        email: "test-engineer@flowdesk.ai",
      },
    });
  }
  if (!testUser.organizationId) {
    throw new Error("Test user has no organizationId. Run scripts/backfill-demo-org.ts first.");
  }
  const userId = testUser.id;
  const organizationId = testUser.organizationId;

  // ----------------------------------------------------
  // TEST 1: SLA Calculators
  // ----------------------------------------------------
  console.log("\n1. Testing SLA Calculators...");
  const slaHigh = calculateSLADeadlines(TicketPriority.HIGH);
  const now = Date.now();
  
  const responseDiffMin = Math.round((slaHigh.firstResponseDueAt.getTime() - now) / 60000);
  const resolutionDiffMin = Math.round((slaHigh.resolutionDueAt.getTime() - now) / 60000);

  console.log(`- HIGH Priority response target offset: ${responseDiffMin} minutes (Expected: 15)`);
  console.log(`- HIGH Priority resolution target offset: ${resolutionDiffMin} minutes (Expected: 60)`);

  if (responseDiffMin !== 15 || resolutionDiffMin !== 60) {
    throw new Error("SLA calculation math is incorrect");
  }
  console.log("✅ SLA calculation targets successfully validated.");

  // ----------------------------------------------------
  // TEST 2: SLA Monitoring & Breach Flagging
  // ----------------------------------------------------
  console.log("\n2. Testing SLA Monitoring & Breach Engine...");
  
  // Create a mock ticket that has already breached its resolution SLA
  const breachedTicket = await prisma.ticket.create({
    data: {
      title: "Test SLA Resolution Breach",
      description: "This ticket has already expired past the SLA timeline.",
      userId,
      organizationId,
      status: TicketStatus.OPEN,
      priority: TicketPriority.HIGH,
      firstResponseDueAt: new Date(now - 30 * 60 * 1000), // 30 mins ago
      resolutionDueAt: new Date(now - 10 * 60 * 1000),    // 10 mins ago
      slaBreached: false,
    },
  });

  console.log(`- Created mock expired ticket ID: ${breachedTicket.id}`);
  
  // Execute evaluation run
  const processedBreaches = await checkSLABreaches();
  console.log(`- SLA monitor run completed. Processed new breaches count: ${processedBreaches}`);

  // Refetch the ticket
  const refetchedTicket = await prisma.ticket.findUnique({
    where: { id: breachedTicket.id },
  });

  console.log(`- SLA Breached status check: ${refetchedTicket?.slaBreached} (Expected: true)`);
  if (!refetchedTicket?.slaBreached) {
    throw new Error("SLA monitoring engine failed to flag breached ticket.");
  }
  
  // Cleanup test ticket
  await prisma.ticket.delete({ where: { id: breachedTicket.id } });
  console.log("✅ SLA breach flagging and database updates validated.");

  // ----------------------------------------------------
  // TEST 3: Document Chunking Algorithm
  // ----------------------------------------------------
  console.log("\n3. Testing Document Chunking Algorithm...");
  const dummyText = "A".repeat(1500); // 1500 chars
  const chunks = chunkTextContent(dummyText, 1000, 200);

  console.log(`- Input length: 1500 chars. Produced chunks count: ${chunks.length} (Expected: 2)`);
  console.log(`- Chunk 1 length: ${chunks[0].length} chars`);
  console.log(`- Chunk 2 length: ${chunks[1].length} chars`);

  if (chunks.length !== 2 || chunks[0].length !== 1000 || chunks[1].length !== 700) {
    throw new Error("Chunking algorithm offset calculation is incorrect");
  }
  console.log("✅ Document chunking logic validated.");

  // ----------------------------------------------------
  // TEST 4: Gemini Embedding Generation
  // ----------------------------------------------------
  console.log("\n4. Testing Gemini Embedding Generation (Gemini API)...");
  const testText = "FlowDesk AI is an enterprise customer support platform.";
  const embedding = await generateEmbedding(testText);

  console.log(`- Embedding array dimension size: ${embedding.length} (Expected: 3072)`);
  if (embedding.length !== 3072) {
    throw new Error("Gemini embedding returned incorrect dimensions");
  }
  console.log("✅ Gemini API embedding generation validated.");

  // ----------------------------------------------------
  // TEST 5 & 6: Vector Search & Retrieval
  // ----------------------------------------------------
  console.log("\n5. Testing Document Ingestion & pgvector Similarity Search...");
  
  // Create a mock document and chunks
  const mockDoc = await prisma.knowledgeDocument.create({
    data: {
      title: "FlowDesk AI Return Policy Guide",
      fileName: "return_policy.txt",
      fileType: "text/plain",
      status: "INDEXED",
      organizationId,
    },
  });

  const chunkTexts = [
    "Customers can request refunds for all subscription plans within 14 days of purchase. Refund request after 14 days is not eligible.",
    "Technical support hours are 9AM to 5PM EST Monday through Friday.",
    "FlowDesk AI is powered by n8n automation and Gemini AI.",
  ];

  const dbChunks = [];
  for (let i = 0; i < chunkTexts.length; i++) {
    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: mockDoc.id,
        organizationId,
        chunkIndex: i,
        content: chunkTexts[i],
      },
    });

    const chunkEmbedding = await generateEmbedding(chunkTexts[i]);
    const vectorString = `[${chunkEmbedding.join(",")}]`;
    await prisma.$executeRaw`UPDATE "DocumentChunk" SET embedding = ${vectorString}::vector WHERE id = ${chunk.id}`;
    dbChunks.push(chunk);
  }

  // Execute similarity search
  console.log("- Querying vector database for similarity to: 'How do I get a refund?'");
  const queryEmbedding = await generateEmbedding("How do I get a refund?");
  const matches = await searchSimilarity(queryEmbedding, organizationId, 3, 0.6);

  console.log(`- Retrieved matching chunks count: ${matches.length}`);
  matches.forEach((m, idx) => {
    console.log(`  [Match #${idx + 1}] Similarity: ${(m.similarity * 100).toFixed(1)}% | Content: "${m.content}"`);
  });

  if (matches.length === 0 || !matches[0].content.includes("refunds for all subscription plans")) {
    throw new Error("pgvector similarity search failed to retrieve correct matching chunk.");
  }
  console.log("✅ Vector database similarity search validated.");

  // ----------------------------------------------------
  // TEST 7: End-to-End Grounded RAG Response
  // ----------------------------------------------------
  console.log("\n6. Testing End-to-End Grounded RAG Chat Response...");
  const incomingMessage = "I purchased a subscription yesterday. Can I get a refund?";
  
  console.log(`- Dispatching customer query: "${incomingMessage}"`);
  const aiResponse = await analyzeWhatsAppMessage(incomingMessage, [], organizationId, userId);

  console.log(`- AI Reply Message: "${aiResponse.replyMessage}"`);
  console.log(`- Needs Escalation: ${aiResponse.needsEscalation} (Expected: false since RAG answers it)`);

  if (aiResponse.needsEscalation) {
    throw new Error("AI Agent unnecessarily escalated the query instead of using the grounded knowledge context.");
  }
  
  if (!aiResponse.replyMessage.toLowerCase().includes("14 days") && !aiResponse.replyMessage.toLowerCase().includes("refund")) {
    throw new Error("AI Agent response was not grounded in the retrieved return policy context.");
  }

  // Cleanup database records
  await prisma.knowledgeDocument.delete({ where: { id: mockDoc.id } });
  console.log("✅ End-to-End Grounded RAG Chat Response validated successfully.");

  console.log("\n====================================================");
  console.log("🎉 ALL SLA & RAG SYSTEM INTEGRATION TESTS PASSED!");
  console.log("====================================================");
}

runTests()
  .catch((err) => {
    console.error("\n❌ SLA & RAG SYSTEM TESTS FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
