import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

export interface TicketAnalysisResult {
  category: "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT";
  priority: "LOW" | "MEDIUM" | "HIGH";
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  suggestedReply: string;
}

export async function analyzeTicket(title: string, description: string): Promise<TicketAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Graceful fallback if API key is not provided
  if (!apiKey || apiKey === "your-gemini-api-key" || apiKey.trim() === "") {
    console.warn("GEMINI_API_KEY is not set. Utilizing fallback rule-based analysis.");
    
    const lowerTitle = title.toLowerCase();
    const lowerDesc = description.toLowerCase();

    // Fallback Category Rules
    let category: TicketAnalysisResult["category"] = "TECHNICAL";
    if (lowerTitle.includes("billing") || lowerDesc.includes("invoice") || lowerDesc.includes("card") || lowerDesc.includes("charge")) {
      category = "BILLING";
    } else if (lowerTitle.includes("refund") || lowerDesc.includes("money back") || lowerDesc.includes("refunded")) {
      category = "REFUND";
    } else if (lowerTitle.includes("delivery") || lowerDesc.includes("ship") || lowerDesc.includes("package") || lowerDesc.includes("track")) {
      category = "DELIVERY";
    } else if (lowerTitle.includes("account") || lowerDesc.includes("password") || lowerDesc.includes("login") || lowerDesc.includes("user")) {
      category = "ACCOUNT";
    }

    // Fallback Priority Rules
    let priority: TicketAnalysisResult["priority"] = "MEDIUM";
    if (lowerTitle.includes("urgent") || lowerDesc.includes("broken") || lowerDesc.includes("crash") || lowerDesc.includes("down") || lowerDesc.includes("immediate")) {
      priority = "HIGH";
    } else if (lowerTitle.includes("question") || lowerDesc.includes("how to") || lowerDesc.includes("inquire")) {
      priority = "LOW";
    }

    // Fallback Sentiment Rules
    let sentiment: TicketAnalysisResult["sentiment"] = "NEUTRAL";
    if (lowerDesc.includes("thank") || lowerDesc.includes("awesome") || lowerDesc.includes("great") || lowerDesc.includes("love")) {
      sentiment = "POSITIVE";
    } else if (lowerDesc.includes("error") || lowerDesc.includes("fail") || lowerDesc.includes("broken") || lowerDesc.includes("useless") || lowerDesc.includes("angry")) {
      sentiment = "NEGATIVE";
    }

    return {
      category,
      priority,
      sentiment,
      suggestedReply: `[Fallback Draft] Hello, thank you for reaching out regarding "${title}". We have flagged this under ${category} and our team will review the details shortly. Let us know if there is any additional context.`,
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Using gemini-1.5-flash which is fast and supports JSON schema responses
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            category: {
              type: SchemaType.STRING,
              format: "enum",
              enum: ["BILLING", "REFUND", "TECHNICAL", "DELIVERY", "ACCOUNT"],
            },
            priority: {
              type: SchemaType.STRING,
              format: "enum",
              enum: ["LOW", "MEDIUM", "HIGH"],
            },
            sentiment: {
              type: SchemaType.STRING,
              format: "enum",
              enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"],
            },
            suggestedReply: {
              type: SchemaType.STRING,
            },
          },
          required: ["category", "priority", "sentiment", "suggestedReply"],
        },
      },
    });

    const prompt = `
      You are an automated customer support assistant for FlowDesk AI.
      Analyze the following ticket title and description, then classify it and compose a suggested response.
      
      Ticket Title: ${title}
      Ticket Description: ${description}
      
      Requirements:
      1. Classify Category strictly into one of: BILLING, REFUND, TECHNICAL, DELIVERY, or ACCOUNT.
      2. Set Priority strictly to LOW, MEDIUM, or HIGH. If the user mentions crash, down, production issue, billing failure, or urgent, mark as HIGH.
      3. Classify Sentiment strictly as POSITIVE, NEUTRAL, or NEGATIVE.
      4. Write suggestedReply as a polite, empathetic, and professional draft addressing their issue.
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    return JSON.parse(text) as TicketAnalysisResult;
  } catch (error) {
    console.error("Gemini API call failed:", error);
    throw new Error("Failed to process ticket content with AI");
  }
}
