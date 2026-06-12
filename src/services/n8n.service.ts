export interface WebhookPayload {
  ticketId: string;
  title: string;
  category: "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT" | "ACCOUNT_ACCESS" | "SUBSCRIPTION" | "GENERAL_INQUIRY";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export async function triggerNewTicketWebhook(payload: WebhookPayload): Promise<{ success: boolean; status?: number; data?: any; error?: string }> {
  const url = process.env.N8N_WEBHOOK_NEW_TICKET;

  console.log(`[n8n Service] Initiating New Ticket Webhook...`);
  console.log(`[n8n Service] URL: ${url}`);
  console.log(`[n8n Service] Payload:`, JSON.stringify(payload, null, 2));

  if (!url || url.trim() === "") {
    console.warn("[n8n Service] N8N_WEBHOOK_NEW_TICKET is not configured. Skipping webhook trigger.");
    return { success: false, error: "Webhook URL not configured" };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log(`[n8n Service] Response received. Status: ${response.status}`);

    // Always read as text first to avoid crashes on empty bodies
    const rawText = await response.text();
    console.log(`[n8n Service] Raw response body: ${rawText || "(empty)"}`);

    if (!response.ok) {
      console.error(`[n8n Service] Webhook failed with status ${response.status}`);
      return { success: false, status: response.status, error: `HTTP ${response.status}: ${rawText || "Empty response"}` };
    }

    // Safely attempt JSON parse
    let responseData: any = null;
    if (rawText && rawText.trim().length > 0) {
      try {
        responseData = JSON.parse(rawText);
      } catch {
        console.warn(`[n8n Service] Response was not valid JSON, using raw text.`);
        responseData = rawText;
      }
    }

    console.log(`[n8n Service] Parsed response data:`, JSON.stringify(responseData, null, 2));

    return { success: true, status: response.status, data: responseData };
  } catch (error: any) {
    console.error("[n8n Service] Exception during webhook execution:", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}

export async function triggerEscalationWebhook(payload: WebhookPayload): Promise<{ success: boolean; status?: number; data?: any; error?: string }> {
  const url = process.env.N8N_WEBHOOK_ESCALATION;

  console.log(`[n8n Service] Initiating High Priority Escalation Webhook...`);
  console.log(`[n8n Service] URL: ${url}`);
  console.log(`[n8n Service] Payload:`, JSON.stringify(payload, null, 2));

  if (!url || url.trim() === "") {
    console.warn("[n8n Service] N8N_WEBHOOK_ESCALATION is not configured. Skipping webhook trigger.");
    return { success: false, error: "Webhook URL not configured" };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log(`[n8n Service] Response received. Status: ${response.status}`);

    // Always read as text first to avoid crashes on empty bodies
    const rawText = await response.text();
    console.log(`[n8n Service] Raw response body: ${rawText || "(empty)"}`);

    if (!response.ok) {
      console.error(`[n8n Service] Webhook failed with status ${response.status}`);
      return { success: false, status: response.status, error: `HTTP ${response.status}: ${rawText || "Empty response"}` };
    }

    // Safely attempt JSON parse
    let responseData: any = null;
    if (rawText && rawText.trim().length > 0) {
      try {
        responseData = JSON.parse(rawText);
      } catch {
        console.warn(`[n8n Service] Response was not valid JSON, using raw text.`);
        responseData = rawText;
      }
    }

    console.log(`[n8n Service] Parsed response data:`, JSON.stringify(responseData, null, 2));

    return { success: true, status: response.status, data: responseData };
  } catch (error: any) {
    console.error("[n8n Service] Exception during webhook execution:", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}

export async function triggerNegativeSentimentWebhook(payload: WebhookPayload): Promise<{ success: boolean; status?: number; data?: any; error?: string }> {
  const url = process.env.N8N_WEBHOOK_NEGATIVE_SENTIMENT;

  console.log(`[n8n Service] Initiating Negative Sentiment Webhook...`);
  console.log(`[n8n Service] URL: ${url}`);
  console.log(`[n8n Service] Payload:`, JSON.stringify(payload, null, 2));

  if (!url || url.trim() === "") {
    console.warn("[n8n Service] N8N_WEBHOOK_NEGATIVE_SENTIMENT is not configured. Skipping webhook trigger.");
    return { success: false, error: "Webhook URL not configured" };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log(`[n8n Service] Response received. Status: ${response.status}`);

    const rawText = await response.text();
    console.log(`[n8n Service] Raw response body: ${rawText || "(empty)"}`);

    if (!response.ok) {
      console.error(`[n8n Service] Webhook failed with status ${response.status}`);
      return { success: false, status: response.status, error: `HTTP ${response.status}: ${rawText || "Empty response"}` };
    }

    let responseData: any = null;
    if (rawText && rawText.trim().length > 0) {
      try {
        responseData = JSON.parse(rawText);
      } catch {
        console.warn(`[n8n Service] Response was not valid JSON, using raw text.`);
        responseData = rawText;
      }
    }

    console.log(`[n8n Service] Parsed response data:`, JSON.stringify(responseData, null, 2));

    return { success: true, status: response.status, data: responseData };
  } catch (error: any) {
    console.error("[n8n Service] Exception during webhook execution:", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}

