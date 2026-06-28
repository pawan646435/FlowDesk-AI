import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";
if (typeof global !== "undefined" && typeof (global as any).DOMMatrix === "undefined") {
  (global as any).DOMMatrix = class DOMMatrix {};
}
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
    try {
      const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      pdfParse.PDFParse.setWorker(workerPath);
    } catch (workerErr) {
      console.warn("[Knowledge Service] Could not resolve local pdf.worker.mjs:", workerErr);
    }
    const parser = new pdfParse.PDFParse({ data: dataBuffer });
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
      
      // Create Database Chunk (without vector field first due to Prisma model limitations)
      const dbChunk = await prisma.documentChunk.create({
        data: {
          documentId,
          chunkIndex: i,
          content,
        },
      });

      // Generate embedding vector using Gemini text-embedding-004
      const embedding = await generateEmbedding(content);

      // Write embedding vector directly using pgvector cast string
      const vectorString = `[${embedding.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "DocumentChunk" SET embedding = $1::vector WHERE id = $2`,
        vectorString,
        dbChunk.id
      );
    }

    // 5. Update status to INDEXED on success
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "INDEXED" },
    });

    console.log(`[Knowledge Service] Document ${doc.fileName} successfully indexed!`);
  } catch (error: any) {
    console.error(`[Knowledge Service] Ingestion failed for document ${documentId}:`, error);

    // Update status to FAILED
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "FAILED" },
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

/**
 * Aggregates knowledge base statistics.
 */
export async function getKnowledgeBaseStats() {
  const [
    totalDocs,
    indexedDocs,
    failedDocs,
    totalChunks,
  ] = await Promise.all([
    prisma.knowledgeDocument.count(),
    prisma.knowledgeDocument.count({ where: { status: "INDEXED" } }),
    prisma.knowledgeDocument.count({ where: { status: "FAILED" } }),
    prisma.documentChunk.count(),
  ]);

  return {
    totalDocuments: totalDocs,
    indexedDocuments: indexedDocs,
    failedDocuments: failedDocs,
    totalChunks,
  };
}
