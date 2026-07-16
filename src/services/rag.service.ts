import prisma from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";

function getEmbeddingModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your-gemini-api-key" || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: "gemini-embedding-001" });
}

/**
 * Generates float array embeddings (768-dim) using Gemini's text-embedding-004.
 */
export async function generateEmbedding(text: string, maxRetries = 3, delay = 500): Promise<number[]> {
  const model = getEmbeddingModel();

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await model.embedContent(text);
      if (result.embedding && result.embedding.values) {
        return result.embedding.values;
      }
      throw new Error("Embed content response was empty");
    } catch (err) {
      attempt++;
      const message = err instanceof Error ? err.message : "Unknown error";
      if (attempt >= maxRetries) {
        console.error(`[Embedding Service] Failed to generate embedding after ${maxRetries} attempts:`, err);
        throw err;
      }
      console.warn(`[Embedding Service] Attempt ${attempt}/${maxRetries} failed: ${message}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }

  throw new Error("Embedding generation failed");
}

// gemini-embedding-001's input token limit is 2,048 tokens per text (docs:
// ai.google.dev/gemini-api/docs/models/gemini-embedding-001) — our ~1000-character RAG
// chunks are well under that, so no per-text truncation is needed here. Google doesn't
// publish an explicit max items-per-batchEmbedContents-call number, so 100 is a
// conservative sub-batch ceiling that keeps individual request/response payloads small
// rather than an attempt to hit a documented limit exactly.
const MAX_BATCH_ITEMS = 100;

export interface BatchEmbeddingResult {
  index: number;
  embedding: number[] | null;
  error: string | null;
}

/**
 * Embeds many texts using batchEmbedContents — one HTTP call carries the whole sub-batch
 * (Gemini embeds each text independently server-side and returns one vector per input, in
 * the same order), instead of the historical one-embedContent-call-per-text loop. Texts
 * are internally split into MAX_BATCH_ITEMS-sized sub-batches and sent sequentially (not
 * concurrently) — sequential sub-batches is deliberate: it keeps this function's own
 * concurrency footprint against Gemini's per-project rate limits equivalent to the single
 * calls it replaces, since the actual win is fewer total HTTP calls per sub-batch, not
 * parallel sub-batches.
 *
 * Returns one BatchEmbeddingResult per input text, positionally aligned with `texts` and
 * carrying its own success/failure independent of the others — a failure in one sub-batch
 * (after retries) is recorded per-item as `{ embedding: null, error }` rather than
 * throwing and losing every other text's result, so callers can persist partial progress
 * and surface which specific chunks failed.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  maxRetries = 3,
  delay = 500
): Promise<BatchEmbeddingResult[]> {
  if (texts.length === 0) return [];

  const model = getEmbeddingModel();
  const results: BatchEmbeddingResult[] = new Array(texts.length);

  for (let start = 0; start < texts.length; start += MAX_BATCH_ITEMS) {
    const subBatch = texts.slice(start, start + MAX_BATCH_ITEMS);
    const subBatchIndices = subBatch.map((_, i) => start + i);

    let attempt = 0;
    let subBatchDelay = delay;
    let succeeded = false;

    while (attempt < maxRetries && !succeeded) {
      try {
        const response = await model.batchEmbedContents({
          requests: subBatch.map((text) => ({
            content: { role: "user", parts: [{ text }] },
          })),
        });

        if (!response.embeddings || response.embeddings.length !== subBatch.length) {
          throw new Error(
            `Batch embed response length mismatch: expected ${subBatch.length}, got ${response.embeddings?.length ?? 0}`
          );
        }

        response.embeddings.forEach((embedding, i) => {
          results[subBatchIndices[i]] = { index: subBatchIndices[i], embedding: embedding.values, error: null };
        });
        succeeded = true;
      } catch (err) {
        attempt++;
        const message = err instanceof Error ? err.message : "Unknown error";
        if (attempt >= maxRetries) {
          console.error(
            `[Embedding Service] Failed to batch-embed chunk range [${start}, ${start + subBatch.length}) after ${maxRetries} attempts:`,
            err
          );
          // Record the failure per-item rather than throwing, so the caller can still
          // persist every other sub-batch's embeddings and report exactly which chunks
          // (by index) failed, instead of losing the whole document's progress.
          subBatchIndices.forEach((idx) => {
            results[idx] = { index: idx, embedding: null, error: message };
          });
        } else {
          console.warn(
            `[Embedding Service] Batch attempt ${attempt}/${maxRetries} for chunk range [${start}, ${start + subBatch.length}) failed: ${message}. Retrying in ${subBatchDelay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, subBatchDelay));
          subBatchDelay *= 2; // Exponential backoff
        }
      }
    }
  }

  return results;
}

export interface SimilaritySearchResult {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

/**
 * Performs vector similarity search using cosine distance <=> operator against Neon/pgvector.
 */
export async function searchSimilarity(
  queryEmbedding: number[],
  organizationId: string,
  limit = 5,
  threshold = 0.7
): Promise<SimilaritySearchResult[]> {
  try {
    const vectorString = `[${queryEmbedding.join(",")}]`;

    // Query Neon PostgreSQL pgvector similarity search, scoped to the caller's org per
    // MULTI_TENANCY_DESIGN.md §4. There's no ANN index on embedding yet (still a brute-force
    // scan), so this equality filter is a cheap addition that can only make the scan faster,
    // not break any index.
    const results = await prisma.$queryRaw<SimilaritySearchResult[]>`
      SELECT
        id,
        "documentId",
        "chunkIndex",
        content,
        1 - (embedding <=> ${vectorString}::vector) AS similarity
      FROM "DocumentChunk"
      WHERE "organizationId" = ${organizationId} AND embedding IS NOT NULL AND 1 - (embedding <=> ${vectorString}::vector) >= ${threshold}
      ORDER BY embedding <=> ${vectorString}::vector ASC
      LIMIT ${limit}
    `;

    return results || [];
  } catch (error) {
    console.error("[RAG Service] Similarity search query failed:", error);
    return [];
  }
}

/**
 * Aggregates RAG performance metrics from Activity logs.
 */
export async function getRAGAnalytics(userId: string, organizationId: string) {
  // Query all RAG activity logs
  const ragActivities = await prisma.activity.findMany({
    where: {
      userId,
      organizationId,
      action: { startsWith: "RAG_RETRIEVAL:" },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalRequests = ragActivities.length;
  let successfulRetrievals = 0;
  let fallbackResponses = 0;
  let totalSimilarity = 0;
  let similarityCounts = 0;

  for (const act of ragActivities) {
    // Action format: "RAG_RETRIEVAL: Query='...', ChunksFound=X, AvgSimilarity=Y"
    const matchChunks = act.action.match(/ChunksFound=(\d+)/);
    const matchSim = act.action.match(/AvgSimilarity=([\d.]+)/);

    const chunks = matchChunks ? parseInt(matchChunks[1], 10) : 0;
    const similarity = matchSim ? parseFloat(matchSim[1]) : 0;

    if (chunks > 0) {
      successfulRetrievals++;
      totalSimilarity += similarity;
      similarityCounts++;
    } else {
      fallbackResponses++;
    }
  }

  const averageSimilarityScore = similarityCounts > 0
    ? parseFloat((totalSimilarity / similarityCounts).toFixed(3))
    : 0;

  return {
    retrievalRequests: totalRequests,
    successfulRetrievals,
    fallbackResponses,
    averageSimilarityScore,
  };
}
