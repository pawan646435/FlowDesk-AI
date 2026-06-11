export interface WebhookPayload {
  ticketId: string;
  title: string;
  category: "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT";
  priority: "LOW" | "MEDIUM" | "HIGH";
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

    if (!response.ok) {
      console.error(`[n8n Service] Webhook failed with status ${response.status}`);
      const text = await response.text();
      console.error(`[n8n Service] Response body: ${text}`);
      return { success: false, status: response.status, error: `HTTP ${response.status}: ${text}` };
    }

    const contentType = response.headers.get("content-type");
    let responseData: any = null;
    if (contentType && contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    console.log(`[n8n Service] Success response data:`, JSON.stringify(responseData, null, 2));

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

    if (!response.ok) {
      console.error(`[n8n Service] Webhook failed with status ${response.status}`);
      const text = await response.text();
      console.error(`[n8n Service] Response body: ${text}`);
      return { success: false, status: response.status, error: `HTTP ${response.status}: ${text}` };
    }

    const contentType = response.headers.get("content-type");
    let responseData: any = null;
    if (contentType && contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    console.log(`[n8n Service] Success response data:`, JSON.stringify(responseData, null, 2));

    return { success: true, status: response.status, data: responseData };
  } catch (error: any) {
    console.error("[n8n Service] Exception during webhook execution:", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}
