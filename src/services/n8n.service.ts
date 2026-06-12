export interface WebhookPayload {
  ticketId: string;
  title: string;
  category: "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT" | "ACCOUNT_ACCESS" | "SUBSCRIPTION" | "GENERAL_INQUIRY";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * Helper function to perform fetch with exponential backoff retries.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  delay = 500
): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, options);
      if (response.ok || attempt >= maxRetries) {
        return response;
      }
      console.warn(`[Retry Helper] Fetch failed with status ${response.status}. Attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${delay}ms...`);
    } catch (err: any) {
      if (attempt >= maxRetries) {
        throw err;
      }
      console.warn(`[Retry Helper] Fetch failed with error: ${err.message}. Attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${delay}ms...`);
    }
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2; // Exponential backoff
  }
}

async function triggerWebhook(
  webhookName: string,
  url: string | undefined,
  payload: WebhookPayload
): Promise<{ success: boolean; status?: number; data?: any; error?: string }> {
  console.log(`[n8n Service] [INFO] Initiating ${webhookName} Webhook...`);
  console.log(`[n8n Service] [INFO] URL: ${url}`);
  console.log(`[n8n Service] [INFO] Payload:`, JSON.stringify(payload, null, 2));

  if (!url || url.trim() === "") {
    console.warn(`[n8n Service] [WARN] Webhook URL for ${webhookName} is not configured. Skipping webhook trigger.`);
    return { success: false, error: "Webhook URL not configured" };
  }

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log(`[n8n Service] [INFO] Response received for ${webhookName}. Status: ${response.status}`);

    const rawText = await response.text();
    console.log(`[n8n Service] [INFO] Raw response body: ${rawText || "(empty)"}`);

    if (!response.ok) {
      console.error(`[n8n Service] [ERROR] ${webhookName} Webhook failed with status ${response.status}`);
      return { success: false, status: response.status, error: `HTTP ${response.status}: ${rawText || "Empty response"}` };
    }

    let responseData: any = null;
    if (rawText && rawText.trim().length > 0) {
      try {
        responseData = JSON.parse(rawText);
      } catch {
        console.warn(`[n8n Service] [WARN] Response was not valid JSON, using raw text.`);
        responseData = rawText;
      }
    }

    console.log(`[n8n Service] [INFO] Parsed response data:`, JSON.stringify(responseData, null, 2));
    return { success: true, status: response.status, data: responseData };
  } catch (error: any) {
    console.error(`[n8n Service] [ERROR] Exception during ${webhookName} webhook execution:`, error);
    return { success: false, error: error.message || "Unknown error" };
  }
}

export async function triggerNewTicketWebhook(payload: WebhookPayload) {
  return triggerWebhook("New Ticket", process.env.N8N_WEBHOOK_NEW_TICKET, payload);
}

export async function triggerEscalationWebhook(payload: WebhookPayload) {
  return triggerWebhook("High Priority Escalation", process.env.N8N_WEBHOOK_ESCALATION, payload);
}

export async function triggerNegativeSentimentWebhook(payload: WebhookPayload) {
  return triggerWebhook("Negative Sentiment", process.env.N8N_WEBHOOK_NEGATIVE_SENTIMENT, payload);
}

export async function triggerResolutionWebhook(payload: WebhookPayload) {
  return triggerWebhook("Ticket Resolution", process.env.N8N_WEBHOOK_RESOLUTION, payload);
}
