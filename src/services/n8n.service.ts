export interface WebhookPayload {
  ticketId: string;
  title: string;
  category: "BILLING" | "REFUND" | "TECHNICAL" | "DELIVERY" | "ACCOUNT";
  priority: "LOW" | "MEDIUM" | "HIGH";
}

export async function triggerNewTicketWebhook(payload: WebhookPayload): Promise<boolean> {
  const url = process.env.N8N_WEBHOOK_NEW_TICKET;

  if (!url || url.trim() === "") {
    console.warn("N8N_WEBHOOK_NEW_TICKET is not configured. Skipping webhook trigger.");
    return false;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`n8n new-ticket webhook returned status ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to call n8n new-ticket webhook:", error);
    return false;
  }
}

export async function triggerEscalationWebhook(payload: WebhookPayload): Promise<boolean> {
  const url = process.env.N8N_WEBHOOK_ESCALATION;

  if (!url || url.trim() === "") {
    console.warn("N8N_WEBHOOK_ESCALATION is not configured. Skipping webhook trigger.");
    return false;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`n8n escalation webhook returned status ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to call n8n escalation webhook:", error);
    return false;
  }
}
