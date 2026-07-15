import prisma from "@/lib/prisma";
import fs from "fs";
const globalRecord = global as unknown as Record<string, unknown>;
if (typeof global !== "undefined" && typeof globalRecord.DOMMatrix === "undefined") {
  globalRecord.DOMMatrix = class DOMMatrix {};
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after the DOMMatrix polyfill above; a hoisted ESM `import` would run before it
const pdfParse = require("pdf-parse");
import { execSync } from "child_process";
import { generateEmbedding } from "./rag.service";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Extracts plain text from TXT, PDF, and DOCX files.
 */
async function extractText(filePath: string, fileType: string): Promise<string> {
  const extension = fileType.toLowerCase();

  if (extension.includes("text") || extension.includes("txt") || filePath.endsWith(".txt")) {
    return fs.readFileSync(filePath, "utf-8");
  }

  if (extension.includes("pdf") || filePath.endsWith(".pdf")) {
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new pdfParse.PDFParse({ 
      data: dataBuffer,
      disableWorker: true 
    });
    const parsedData = await parser.getText();
    return parsedData.text || "";
  }

  if (extension.includes("word") || extension.includes("docx") || filePath.endsWith(".docx")) {
    try {
      const xml = execSync(`unzip -p "${filePath}" word/document.xml`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString("utf-8");
      // Strip XML tags and clean spacing
      return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    } catch (err) {
      console.warn("[Knowledge Service] Docx shell unzip failed, falling back to raw binary search:", err);
      // Fallback raw character matcher
      const raw = fs.readFileSync(filePath, "utf-8");
      return raw
        .replace(/<[^>]+>/g, " ")
        .replace(/[^\x20-\x7E\n\r\t]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  throw new Error(`Unsupported document file format type: ${fileType}`);
}

/**
 * Splits text into chunks with sliding-window overlap.
 */
export function chunkTextContent(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  const cleanedText = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  
  let index = 0;
  while (index < cleanedText.length) {
    const chunk = cleanedText.slice(index, index + chunkSize);
    chunks.push(chunk);
    
    index += chunkSize - overlap;
    // Prevent infinite loop if index isn't progressing
    if (chunkSize - overlap <= 0) break;
  }

  return chunks;
}

/**
 * Core background processing worker representing the Document Ingestion Pipeline.
 */
export async function processAndIndexDocument(documentId: string, tempFilePath: string) {
  console.log(`[Knowledge Service] Ingesting Document ID: ${documentId}`);

  try {
    // 1. Fetch document metadata
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) {
      throw new Error(`Document ${documentId} not found in database.`);
    }

    // Update status to PROCESSING
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "PROCESSING" },
    });

    // 2. Parse text content
    const text = await extractText(tempFilePath, doc.fileType);
    console.log(`[Knowledge Service] Extracted ${text.length} characters from ${doc.fileName}`);

    if (text.trim().length === 0) {
      throw new Error("No text content could be extracted from this document.");
    }

    // 3. Segment text into overlap chunks
    const chunks = chunkTextContent(text);
    console.log(`[Knowledge Service] Generated ${chunks.length} chunks for indexing`);

    // 4. Save and index chunks sequentially
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      
      // Create Database Chunk (without vector field first due to Prisma model limitations).
      // organizationId comes straight off the document row already fetched above — the
      // document was created org-scoped at upload time, so this just carries it through.
      const dbChunk = await prisma.documentChunk.create({
        data: {
          documentId,
          organizationId: doc.organizationId,
          chunkIndex: i,
          content,
        },
      });

      // Generate embedding vector using Gemini text-embedding-004
      const embedding = await generateEmbedding(content);

      // Write embedding vector directly using pgvector cast string
      const vectorString = `[${embedding.join(",")}]`;
      await prisma.$executeRaw`UPDATE "DocumentChunk" SET embedding = ${vectorString}::vector WHERE id = ${dbChunk.id}`;
    }

    // 5. Update status to INDEXED on success
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "INDEXED" },
    });

    console.log(`[Knowledge Service] Document ${doc.fileName} successfully indexed!`);
  } catch (error) {
    console.error(`[Knowledge Service] Ingestion failed for document ${documentId}:`, error);

    // Update status to FAILED
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "Unknown error during ingestion.",
      },
    });
  } finally {
    // Delete local temporary file
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (unlinkErr) {
      console.warn(`[Knowledge Service] Failed to remove temp file ${tempFilePath}:`, unlinkErr);
    }
  }
}

// How long a document can sit in PROCESSING before we consider the job dead rather
// than just slow. There is no maxDuration override on the upload route, so it runs
// under Vercel's platform default execution ceiling — genuinely healthy processing
// realistically can't run for many minutes uninterrupted. 10 minutes (not the 5
// initially suggested) gives headroom for large documents: chunk embedding is done
// sequentially, one Gemini API call per ~800 new characters, so a large upload near
// the UI's 10MB cap can legitimately take several minutes even when nothing is wrong.
const STUCK_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Finds KnowledgeDocument rows stuck in PROCESSING past STUCK_PROCESSING_THRESHOLD_MS
 * and marks them FAILED with a clear reason.
 *
 * This does NOT retry or resume processing. The uploaded file only ever existed as an
 * ephemeral local path (./tmp/...) on the specific serverless instance that received
 * the upload; once that instance is frozen or recycled, the source bytes are gone with
 * no durable copy anywhere. A stuck document therefore can't be safely re-parsed,
 * re-chunked, or re-embedded from where it left off — there is nothing left to resume
 * from. Recovery is: fail it clearly, and let the user re-upload via the Knowledge Base
 * UI (which already supports deleting a FAILED document and uploading again).
 */
export async function recoverStuckDocuments(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS);

  const stuckDocuments = await prisma.knowledgeDocument.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: cutoff },
    },
  });

  console.log(`[Knowledge Service] Found ${stuckDocuments.length} candidate stuck documents.`);

  let recoveredCount = 0;

  for (const doc of stuckDocuments) {
    // Atomically claim recovery of this document, same compare-and-swap pattern as the
    // SLA breach sweep: the WHERE clause re-checks status at write time, so if the
    // original invocation was just slow (not dead) and finished between our findMany()
    // above and this update, `count` comes back 0 and we leave its real outcome alone.
    const claim = await prisma.knowledgeDocument.updateMany({
      where: { id: doc.id, status: "PROCESSING" },
      data: {
        status: "FAILED",
        failureReason: `Processing timed out — stuck in PROCESSING for over ${STUCK_PROCESSING_THRESHOLD_MS / 60000} minutes, likely a serverless function interruption before completion. Please re-upload the document to retry.`,
      },
    });

    if (claim.count === 0) {
      console.log(`[Knowledge Service] Document ${doc.id} resolved on its own before recovery could claim it, skipping.`);
      continue;
    }

    recoveredCount++;
    console.log(`[Knowledge Service] Marked stuck document ${doc.id} (${doc.fileName}) as FAILED.`);

    // Clean up any partial chunks written before the interruption. Some may already
    // have embeddings and would otherwise keep surfacing in RAG search results forever
    // for a document the UI now shows as FAILED. Safe to do unconditionally here since
    // we exclusively own this document's outcome once the claim above succeeds, and
    // nothing will ever resume indexing into this specific document id.
    await prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });
  }

  return recoveredCount;
}

/**
 * Aggregates knowledge base statistics.
 */
export async function getKnowledgeBaseStats(organizationId: string) {
  const [
    totalDocs,
    indexedDocs,
    failedDocs,
    totalChunks,
  ] = await Promise.all([
    prisma.knowledgeDocument.count({ where: { organizationId } }),
    prisma.knowledgeDocument.count({ where: { status: "INDEXED", organizationId } }),
    prisma.knowledgeDocument.count({ where: { status: "FAILED", organizationId } }),
    prisma.documentChunk.count({ where: { organizationId } }),
  ]);

  return {
    totalDocuments: totalDocs,
    indexedDocuments: indexedDocs,
    failedDocuments: failedDocs,
    totalChunks,
  };
}
