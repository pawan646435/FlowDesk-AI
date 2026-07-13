import prisma from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Generates float array embeddings (768-dim) using Gemini's text-embedding-004.
 */
export async function generateEmbedding(text: string, maxRetries = 3, delay = 500): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your-gemini-api-key" || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

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
  limit = 5,
  threshold = 0.7
): Promise<SimilaritySearchResult[]> {
  try {
    const vectorString = `[${queryEmbedding.join(",")}]`;

    // Query Neon PostgreSQL pgvector similarity search
    const results = await prisma.$queryRaw<SimilaritySearchResult[]>`
      SELECT
        id,
        "documentId",
        "chunkIndex",
        content,
        1 - (embedding <=> ${vectorString}::vector) AS similarity
      FROM "DocumentChunk"
      WHERE embedding IS NOT NULL AND 1 - (embedding <=> ${vectorString}::vector) >= ${threshold}
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
export async function getRAGAnalytics(userId: string) {
  // Query all RAG activity logs
  const ragActivities = await prisma.activity.findMany({
    where: {
      userId,
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
