import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";

export interface TicketAnalysisResult {
  category: "BILLING" | "TECHNICAL" | "REFUND" | "ACCOUNT_ACCESS" | "SUBSCRIPTION" | "GENERAL_INQUIRY";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  suggestedReply: string;
  aiSummary: string;
  keyIssues: string;
  recommendedTeam: string;
}

// Zod Validation Schema for AI Output
const ticketAnalysisSchema = z.object({
  category: z.enum(["BILLING", "TECHNICAL", "REFUND", "ACCOUNT_ACCESS", "SUBSCRIPTION", "GENERAL_INQUIRY"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  suggestedReply: z.string().min(1, "Suggested reply cannot be empty"),
  aiSummary: z.string().min(1, "AI summary cannot be empty"),
  keyIssues: z.string().min(1, "Key issues cannot be empty"),
  recommendedTeam: z.string().min(1, "Recommended team cannot be empty"),
});

export async function analyzeTicket(title: string, description: string): Promise<TicketAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Rule-Based Fallback logic if API key is not configured or in case of critical error
  const getRuleBasedFallback = (t: string, d: string): TicketAnalysisResult => {
    const lowerTitle = t.toLowerCase();
    const lowerDesc = d.toLowerCase();

    // V2 Category Fallback Rules
    let category: TicketAnalysisResult["category"] = "GENERAL_INQUIRY";
    if (lowerTitle.includes("billing") || lowerDesc.includes("invoice") || lowerDesc.includes("card") || lowerDesc.includes("charge") || lowerDesc.includes("payment")) {
      category = "BILLING";
    } else if (lowerTitle.includes("refund") || lowerDesc.includes("money back") || lowerDesc.includes("refunded") || lowerDesc.includes("reimburse")) {
      category = "REFUND";
    } else if (lowerTitle.includes("access") || lowerDesc.includes("password") || lowerDesc.includes("login") || lowerDesc.includes("locked") || lowerDesc.includes("login error")) {
      category = "ACCOUNT_ACCESS";
    } else if (lowerTitle.includes("subscription") || lowerDesc.includes("renew") || lowerDesc.includes("cancel") || lowerDesc.includes("upgrade") || lowerDesc.includes("plan")) {
      category = "SUBSCRIPTION";
    } else if (lowerTitle.includes("bug") || lowerDesc.includes("error") || lowerDesc.includes("broken") || lowerDesc.includes("crash") || lowerDesc.includes("fail") || lowerDesc.includes("not working") || lowerDesc.includes("technical")) {
      category = "TECHNICAL";
    }

    // V2 Priority Fallback Rules
    let priority: TicketAnalysisResult["priority"] = "MEDIUM";
    if (lowerTitle.includes("entire company") || lowerDesc.includes("everyone cannot") || lowerDesc.includes("platform down") || lowerDesc.includes("critical outage")) {
      priority = "CRITICAL";
    } else if (lowerTitle.includes("urgent") || lowerDesc.includes("broken") || lowerDesc.includes("payment deducted") || lowerDesc.includes("service unavailable") || lowerDesc.includes("immediate")) {
      priority = "HIGH";
    } else if (lowerTitle.includes("question") || lowerDesc.includes("how to") || lowerDesc.includes("inquire") || lowerDesc.includes("dark mode")) {
      priority = "LOW";
    }

    // Sentiment Fallback Rules
    let sentiment: TicketAnalysisResult["sentiment"] = "NEUTRAL";
    if (lowerDesc.includes("thank") || lowerDesc.includes("awesome") || lowerDesc.includes("great") || lowerDesc.includes("love") || lowerDesc.includes("happy")) {
      sentiment = "POSITIVE";
    } else if (lowerDesc.includes("error") || lowerDesc.includes("fail") || lowerDesc.includes("broken") || lowerDesc.includes("useless") || lowerDesc.includes("angry") || lowerDesc.includes("worst") || lowerDesc.includes("sucks")) {
      sentiment = "NEGATIVE";
    }

    // Recommended Team Fallback
    const recommendedTeam = category === "BILLING" || category === "REFUND"
      ? "Billing Operations"
      : category === "ACCOUNT_ACCESS"
      ? "Identity Security"
      : category === "SUBSCRIPTION"
      ? "Accounts & Growth"
      : "Technical Support";

    return {
      category,
      priority,
      sentiment,
      suggestedReply: `[Fallback Draft] Hello, thank you for reaching out regarding "${t}". We have classified this ticket under ${category.replace("_", " ")} and our team will review the details shortly. Let us know if there is any additional context.`,
      aiSummary: `Customer reports an issue regarding "${t}" classified under ${category}.`,
      keyIssues: `${t}`,
      recommendedTeam,
    };
  };

  if (!apiKey || apiKey === "your-gemini-api-key" || apiKey.trim() === "") {
    console.warn("GEMINI_API_KEY is not set. Utilizing fallback rule-based analysis.");
    return getRuleBasedFallback(title, description);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Using gemini-2.5-flash for structured JSON response output
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
              enum: ["BILLING", "TECHNICAL", "REFUND", "ACCOUNT_ACCESS", "SUBSCRIPTION", "GENERAL_INQUIRY"],
            },
            priority: {
              type: SchemaType.STRING,
              format: "enum",
              enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            },
            sentiment: {
              type: SchemaType.STRING,
              format: "enum",
              enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"],
            },
            suggestedReply: {
              type: SchemaType.STRING,
            },
            aiSummary: {
              type: SchemaType.STRING,
            },
            keyIssues: {
              type: SchemaType.STRING,
            },
            recommendedTeam: {
              type: SchemaType.STRING,
            },
          },
          required: ["category", "priority", "sentiment", "suggestedReply", "aiSummary", "keyIssues", "recommendedTeam"],
        },
      },
    });

    const prompt = `
      You are an automated support ticket classifier AI for FlowDesk AI.
      Analyze the following ticket title and description, then return a structured JSON response.
      
      Ticket Title: ${title}
      Ticket Description: ${description}
      
      Requirements:
      1. Classify Category strictly as: BILLING, TECHNICAL, REFUND, ACCOUNT_ACCESS, SUBSCRIPTION, or GENERAL_INQUIRY.
         - BILLING: Invoices, payment charges, double billing.
         - TECHNICAL: Bugs, service errors, site not loading.
         - REFUND: Refunds, chargeback claims.
         - ACCOUNT_ACCESS: Locked out, password resets.
         - SUBSCRIPTION: Upgrading plan, canceling plan, subscription renew.
         - GENERAL_INQUIRY: Standard queries, feedback, feature suggestions, or general questions.
      2. Set Priority strictly to: LOW, MEDIUM, HIGH, or CRITICAL.
         - LOW: Minor issues, styling, dark mode, standard questions.
         - MEDIUM: Default issue priority.
         - HIGH: Deductions, payment made but service unavailable, urgent single user blocking.
         - CRITICAL: System down, entire company cannot login, major production outage.
      3. Classify Sentiment strictly as: POSITIVE, NEUTRAL, or NEGATIVE.
      4. Write suggestedReply as a polite, empathetic, and professional draft addressing their issue.
      5. Write aiSummary as a brief, one-sentence support agent summary of the core issue.
         - Format: "Customer reports [issue summary]."
      6. Write keyIssues as a comma-separated list of 1-3 core points of concern.
         - Example: "Duplicate charge, Account locked"
      7. Write recommendedTeam as a professional support division names.
         - Example: "Billing", "Technical Operations", "Accounts", or "Security".
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    console.log(`[AI Service] Raw AI output received: ${text}`);

    // Parse JSON
    const parsedData = JSON.parse(text);

    // Run Zod validation layer
    const validatedData = ticketAnalysisSchema.parse(parsedData);
    return validatedData;

  } catch (error) {
    console.error("[AI Service] Gemini API call or validation failed, utilizing fallback:", error);
    // Return rule-based fallback instead of throwing to guarantee uptime
    return getRuleBasedFallback(title, description);
  }
}

export interface WhatsAppHistoryItem {
  sender: "CUSTOMER" | "AI" | "SYSTEM" | "AGENT";
  text: string;
  createdAt?: Date;
}

export interface WhatsAppAnalysisResult {
  needsEscalation: boolean;
  replyMessage: string;
  ticketData?: {
    title: string;
    description: string;
    category: "BILLING" | "TECHNICAL" | "REFUND" | "ACCOUNT_ACCESS" | "SUBSCRIPTION" | "GENERAL_INQUIRY";
    priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    aiSummary: string;
    keyIssues: string;
    recommendedTeam: string;
  };
}

const whatsappAnalysisSchema = z.object({
  needsEscalation: z.boolean(),
  replyMessage: z.string(),
  ticketData: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(["BILLING", "TECHNICAL", "REFUND", "ACCOUNT_ACCESS", "SUBSCRIPTION", "GENERAL_INQUIRY"]),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
    aiSummary: z.string(),
    keyIssues: z.string(),
    recommendedTeam: z.string(),
  }).optional(),
});

export async function analyzeWhatsAppMessage(
  incomingMessage: string,
  history: WhatsAppHistoryItem[]
): Promise<WhatsAppAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  const getFallbackWhatsAppAnalysis = (msg: string): WhatsAppAnalysisResult => {
    const lowerMsg = msg.toLowerCase();
    const needsEscalation =
      lowerMsg.includes("human") ||
      lowerMsg.includes("agent") ||
      lowerMsg.includes("person") ||
      lowerMsg.includes("operator") ||
      lowerMsg.includes("escalate") ||
      lowerMsg.includes("error") ||
      lowerMsg.includes("crash") ||
      lowerMsg.includes("broken") ||
      lowerMsg.includes("billing") ||
      lowerMsg.includes("charge") ||
      lowerMsg.includes("refund") ||
      lowerMsg.includes("payment") ||
      lowerMsg.includes("locked") ||
      lowerMsg.includes("urgent") ||
      lowerMsg.includes("fail") ||
      lowerMsg.includes("not working");

    if (needsEscalation) {
      // Predict category
      let category: "BILLING" | "TECHNICAL" | "REFUND" | "ACCOUNT_ACCESS" | "SUBSCRIPTION" | "GENERAL_INQUIRY" = "GENERAL_INQUIRY";
      if (lowerMsg.includes("billing") || lowerMsg.includes("charge") || lowerMsg.includes("payment")) {
        category = "BILLING";
      } else if (lowerMsg.includes("refund")) {
        category = "REFUND";
      } else if (lowerMsg.includes("locked") || lowerMsg.includes("password") || lowerMsg.includes("login")) {
        category = "ACCOUNT_ACCESS";
      } else if (lowerMsg.includes("subscribe") || lowerMsg.includes("plan") || lowerMsg.includes("cancel")) {
        category = "SUBSCRIPTION";
      } else if (lowerMsg.includes("error") || lowerMsg.includes("crash") || lowerMsg.includes("broken") || lowerMsg.includes("not working")) {
        category = "TECHNICAL";
      }

      const priority = lowerMsg.includes("urgent") || lowerMsg.includes("emergency") || lowerMsg.includes("immediate") ? "HIGH" : "MEDIUM";
      const sentiment = "NEGATIVE";

      const recommendedTeam = category === "BILLING" || category === "REFUND"
        ? "Billing Operations"
        : category === "ACCOUNT_ACCESS"
        ? "Identity Security"
        : category === "SUBSCRIPTION"
        ? "Accounts & Growth"
        : "Technical Support";

      return {
        needsEscalation: true,
        replyMessage: "I understand you need assistance with a critical issue. I am transferring this conversation to a support agent and opening a ticket for you. An agent will contact you here shortly.",
        ticketData: {
          title: `WhatsApp Escalation: ${msg.slice(0, 40)}${msg.length > 40 ? "..." : ""}`,
          description: `Conversation escalated from WhatsApp. Customer message: "${msg}"`,
          category,
          priority,
          sentiment,
          aiSummary: `WhatsApp customer requested escalation for: "${msg.slice(0, 50)}"`,
          keyIssues: category.toLowerCase().replace("_", " "),
          recommendedTeam,
        },
      };
    } else {
      return {
        needsEscalation: false,
        replyMessage: `[AI Assistant] Hello! Thank you for messaging FlowDesk AI. I'm here to help. If you have any technical bugs, billing queries, or login issues, please let me know. How can I help you today?`,
      };
    }
  };

  if (!apiKey || apiKey === "your-gemini-api-key" || apiKey.trim() === "") {
    console.warn("GEMINI_API_KEY is not set. Utilizing fallback WhatsApp AI reply.");
    return getFallbackWhatsAppAnalysis(incomingMessage);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            needsEscalation: {
              type: SchemaType.BOOLEAN,
            },
            replyMessage: {
              type: SchemaType.STRING,
            },
            ticketData: {
              type: SchemaType.OBJECT,
              properties: {
                title: { type: SchemaType.STRING },
                description: { type: SchemaType.STRING },
                category: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: ["BILLING", "TECHNICAL", "REFUND", "ACCOUNT_ACCESS", "SUBSCRIPTION", "GENERAL_INQUIRY"],
                },
                priority: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
                },
                sentiment: {
                  type: SchemaType.STRING,
                  format: "enum",
                  enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"],
                },
                aiSummary: { type: SchemaType.STRING },
                keyIssues: { type: SchemaType.STRING },
                recommendedTeam: { type: SchemaType.STRING },
              },
              required: ["title", "description", "category", "priority", "sentiment", "aiSummary", "keyIssues", "recommendedTeam"],
            },
          },
          required: ["needsEscalation", "replyMessage"],
        },
      },
    });

    const formattedHistory = history
      .map((h) => `${h.sender === "CUSTOMER" ? "Customer" : "AI Assistant"}: ${h.text}`)
      .join("\n");

    const prompt = `
      You are a conversational support agent for FlowDesk AI.
      You are chatting with a customer on WhatsApp.
      
      Review the conversation history and the new message from the customer.
      Decide if the customer needs human agent assistance (escalation) or if you can handle it via self-service.
      
      Conversation History:
      ${formattedHistory || "(No previous messages)"}
      
      New Message:
      Customer: ${incomingMessage}
      
      Guidelines:
      1. needsEscalation: Set to true if:
         - The customer explicitly asks for a human, agent, operator, person, or to escalate.
         - The customer is expressing high frustration, anger, or urgency.
         - The issue is a complex error, billing discrepancy, security breach, account lockout, or server outage that a generic AI cannot resolve directly.
         Set to false if it's a general question, greeting, or something that can be answered immediately.
      2. replyMessage:
         - If needsEscalation is true: Empathize with the customer and politely explain that you are creating a support ticket and transferring them to a human team member. Mention that an agent will follow up soon.
         - If needsEscalation is false: Reply directly to their question or provide self-service help in a helpful, friendly, and concise manner suited for WhatsApp messages (use bullet points or emojis if helpful).
      3. ticketData:
         - Provide this ONLY if needsEscalation is true. Do not include it if needsEscalation is false.
         - Populate:
           - title: A concise summary of the issue (e.g., "Locked out of billing portal").
           - description: A clear description of the problem based on the message and history.
           - category: Choose from: BILLING, TECHNICAL, REFUND, ACCOUNT_ACCESS, SUBSCRIPTION, GENERAL_INQUIRY.
           - priority: Choose from: LOW, MEDIUM, HIGH, CRITICAL. Set to HIGH/CRITICAL if it represents a serious billing issue or blocking bug, otherwise MEDIUM.
           - sentiment: Choose from: POSITIVE, NEUTRAL, NEGATIVE.
           - aiSummary: A one-sentence summary starting with "Customer reports..."
           - keyIssues: Comma-separated list of 1-3 issues.
           - recommendedTeam: Suggest a team like "Billing Operations", "Technical Support", "Security", or "Accounts".
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log(`[AI Service WhatsApp] Raw AI output: ${text}`);

    const parsed = JSON.parse(text);
    return whatsappAnalysisSchema.parse(parsed) as WhatsAppAnalysisResult;
  } catch (error) {
    console.error("[AI Service WhatsApp] Gemini API call or validation failed, utilizing fallback:", error);
    return getFallbackWhatsAppAnalysis(incomingMessage);
  }
}

