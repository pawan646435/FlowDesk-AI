import prisma from "@/lib/prisma";

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
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[Retry Helper] Fetch failed with error: ${message}. Attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${delay}ms...`);
    }
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2; // Exponential backoff
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/**
 * True if `url` resolves to localhost/127.0.0.1 AND we're running in production.
 * n8n is only deployed locally via Docker for now, so a production instance still
 * pointed at localhost can never succeed. Not flagged outside production, because
 * local dev is *expected* to point at localhost — that's how the Docker setup works.
 * Malformed URLs return false and are left for the normal fetch path to attempt/report.
 */
function isProductionLoopbackUrl(url: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Cheap pre-flight guard shared by every trigger function via triggerWebhook: decides
 * whether a webhook call is even worth attempting, before any network I/O or retries.
 * Skips (with a single log line, no retries) on an unset/empty URL in any environment,
 * or a production deployment still configured with a localhost/127.0.0.1 URL.
 */
async function triggerWebhook<T extends object>(
  webhookName: string,
  url: string | null | undefined,
  payload: T
): Promise<{ success: boolean; status?: number; data?: unknown; error?: string }> {
  if (!url || url.trim() === "") {
    console.log(`[N8N SKIPPED] webhook not configured: ${webhookName}`);
    return { success: false, error: "webhook not configured" };
  }

  if (isProductionLoopbackUrl(url)) {
    console.log(`[N8N SKIPPED] webhook not configured for production: ${webhookName}`);
    return { success: false, error: "webhook not configured for production" };
  }

  console.log(`[n8n Service] [INFO] Initiating ${webhookName} Webhook...`);
  console.log(`[n8n Service] [INFO] URL: ${url}`);
  console.log(`[n8n Service] [INFO] Payload:`, JSON.stringify(payload, null, 2));

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

    let responseData: unknown = null;
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
  } catch (error) {
    console.error(`[n8n Service] [ERROR] Exception during ${webhookName} webhook execution:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * MULTI_TENANCY_DESIGN.md §7 — webhook URLs are looked up per-org, not from a global
 * env var. No org falls back to any other org's URL or to a shared default; an org with
 * no OrganizationWebhookConfig row (or a null field on it) simply has that webhook
 * skipped, via the same triggerWebhook guard used for a genuinely unconfigured URL.
 */
async function getOrgWebhookConfig(organizationId: string) {
  return prisma.organizationWebhookConfig.findUnique({ where: { organizationId } });
}

export type OrgWebhookConfig = Awaited<ReturnType<typeof getOrgWebhookConfig>>;

/**
 * Batch variant of getOrgWebhookConfig for callers that need configs for several orgs at
 * once (the SLA breach sweep spans every org in one run, per its deliberately-global
 * scope) — one query for all of them instead of one findUnique per org. Orgs with no
 * OrganizationWebhookConfig row simply have no entry in the returned map, same
 * "unconfigured, skip cleanly" outcome as getOrgWebhookConfig returning null.
 */
export async function getOrgWebhookConfigsByOrgIds(
  organizationIds: string[]
): Promise<Map<string, OrgWebhookConfig>> {
  const uniqueIds = [...new Set(organizationIds)];
  if (uniqueIds.length === 0) return new Map();

  const configs = await prisma.organizationWebhookConfig.findMany({
    where: { organizationId: { in: uniqueIds } },
  });

  return new Map(configs.map((config) => [config.organizationId, config]));
}

export async function triggerNewTicketWebhook(organizationId: string, payload: WebhookPayload) {
  const config = await getOrgWebhookConfig(organizationId);
  return triggerWebhook("New Ticket", config?.newTicketUrl, payload);
}

export async function triggerEscalationWebhook(organizationId: string, payload: WebhookPayload) {
  const config = await getOrgWebhookConfig(organizationId);
  return triggerWebhook("High Priority Escalation", config?.escalationUrl, payload);
}

export async function triggerNegativeSentimentWebhook(organizationId: string, payload: WebhookPayload) {
  const config = await getOrgWebhookConfig(organizationId);
  return triggerWebhook("Negative Sentiment", config?.negativeSentimentUrl, payload);
}

export async function triggerResolutionWebhook(organizationId: string, payload: WebhookPayload) {
  const config = await getOrgWebhookConfig(organizationId);
  return triggerWebhook("Ticket Resolution", config?.resolutionUrl, payload);
}

export interface SlaBreachWebhookPayload {
  ticketId: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
  customerName: string;
  breachDuration: string;
}

/**
 * config is pre-fetched by the caller (getOrgWebhookConfigsByOrgIds) rather than looked
 * up here — the SLA breach sweep is the only caller, and it spans every org in one run,
 * so it batches the config lookup once up front instead of once per ticket.
 */
export async function triggerSlaBreachWebhook(config: OrgWebhookConfig, payload: SlaBreachWebhookPayload) {
  // Falls back to this org's own escalation URL if it has no dedicated SLA breach URL
  // configured — same fallback relationship the global-env-var version had between
  // N8N_WEBHOOK_SLA_BREACH and N8N_WEBHOOK_ESCALATION, just scoped to one org now
  // instead of reaching across to a different env var.
  return triggerWebhook("SLA Breach", config?.slaBreachUrl || config?.escalationUrl, payload);
}
