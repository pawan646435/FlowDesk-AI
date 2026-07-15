import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { processAndIndexDocument, getKnowledgeBaseStats } from "@/services/knowledge.service";
import { getRAGAnalytics } from "@/services/rag.service";
import fs from "fs";
import path from "path";

// GET handler to list documents and aggregate analytics
export async function GET() {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // MULTI_TENANCY_DESIGN.md §3: previously returned every document in the database
    // with no scoping at all beyond requiring some authenticated session.
    const documents = await prisma.knowledgeDocument.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { createdAt: "desc" },
    });

    const kbStats = await getKnowledgeBaseStats(session.user.organizationId);
    const ragStats = await getRAGAnalytics(session.user.id, session.user.organizationId);

    return NextResponse.json({
      success: true,
      documents,
      stats: {
        ...kbStats,
        ...ragStats,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST handler to upload a document
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }

    const fileName = file.name;
    const fileType = file.type || path.extname(fileName);
    const title = formData.get("title") as string || fileName.replace(/\.[^/.]+$/, "");

    // Supported formats check
    const extension = path.extname(fileName).toLowerCase();
    if (extension !== ".txt" && extension !== ".pdf" && extension !== ".docx") {
      return NextResponse.json(
        { error: "Unsupported file type. Only PDF, DOCX, and TXT are supported." },
        { status: 400 }
      );
    }

    // Read file data into Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save temporary file in workspace uploads dir
    const uploadDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const tempFilePath = path.join(uploadDir, `${Date.now()}-${fileName}`);
    fs.writeFileSync(tempFilePath, buffer);

    // Create KnowledgeDocument record in PENDING state
    const document = await prisma.knowledgeDocument.create({
      data: {
        title,
        fileName,
        fileType,
        status: "PENDING",
        organizationId: session.user.organizationId,
      },
    });

    // Spawn background worker to parse, chunk, embed, and index document
    const indexPromise = processAndIndexDocument(document.id, tempFilePath);

    // If waitUntil is available in request context, defer task, otherwise execute asynchronously
    const reqWithWaitUntil = req as NextRequest & { waitUntil?: (promise: Promise<unknown>) => void };
    if (reqWithWaitUntil.waitUntil) {
      reqWithWaitUntil.waitUntil(indexPromise);
    } else {
      // In development server
      indexPromise.catch((err) => console.error("[Background Indexing] Failed:", err));
    }

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully. Document processing started in the background.",
      document,
    });
  } catch (error) {
    console.error("[Knowledge API] Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
