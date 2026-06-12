# FlowDesk AI WhatsApp Business API Setup Guide

This guide details the end-to-end setup for the production-hardened WhatsApp customer support channel. It covers Meta Developer Portal configuration, environment variables, webhook signatures, n8n workflow deployment, and testing.

---

## 1. Meta Developer Portal Setup

### A. Create a Meta Developer App
1. Go to the [Meta for Developers Portal](https://developers.facebook.com/).
2. Log in and navigate to **My Apps** > **Create App**.
3. Choose **Other** -> **Business** app type.
4. Provide an App Name (e.g. `FlowDesk Support`) and click **Create App**.

### B. Add the WhatsApp Product
1. From the App Dashboard, scroll to **Add products to your app**.
2. Click **Set up** on the **WhatsApp** card.
3. Accept the Terms and select/create a Business Manager account.

### C. Retrieve Account IDs & Tokens
On the **WhatsApp > API Setup** tab:
- **Phone Number ID**: A 15-digit number string (corresponds to `WHATSAPP_PHONE_NUMBER_ID`).
- **WhatsApp Business Account ID**: A 15-digit number string (corresponds to `WHATSAPP_BUSINESS_ACCOUNT_ID`).
- **Temporary Access Token**: Copy this for testing (note: it expires in 24 hours). For production, generate a permanent **System User Access Token** in your Meta Business Suite.

---

## 2. Environment Variables Configuration

Copy these keys into your FlowDesk AI `.env` file (see [/.env.example](file:///Users/pawan/Projects/Flowdesk%20AI/.env.example)):

```bash
# Meta WhatsApp Credentials
WHATSAPP_ACCESS_TOKEN="EAAC..." # Your permanent System User Token
WHATSAPP_PHONE_NUMBER_ID="104505886392019" # From WhatsApp API Setup
WHATSAPP_BUSINESS_ACCOUNT_ID="109825475304918" # From WhatsApp API Setup
WHATSAPP_VERIFY_TOKEN="your_chosen_random_verify_token" # Configured in webhooks

# Meta App Secret (Crucial for webhook signature verification)
# Find this under App Dashboard > App Settings > Basic > App Secret
WHATSAPP_APP_SECRET="your_32_character_hex_app_secret"

# n8n Webhooks
N8N_WEBHOOK_NEW_TICKET="http://<your-n8n-instance>:5678/webhook/new-ticket"
N8N_WEBHOOK_ESCALATION="http://<your-n8n-instance>:5678/webhook/escalate-ticket"
N8N_WEBHOOK_NEGATIVE_SENTIMENT="http://<your-n8n-instance>:5678/webhook/negative-sentiment"
N8N_WEBHOOK_RESOLUTION="http://<your-n8n-instance>:5678/webhook/whatsapp-resolution"
```

---

## 3. Webhook Integration

### A. Exposing Your Server
WhatsApp requires an HTTPS endpoint to verify and dispatch webhooks. For local testing, use a tunneling service:
```bash
# Tunnel your Next.js local server (default port 3000)
ngrok http 3000
```
This will generate a secure public URL like `https://xxxx.ngrok-free.app`.

### B. Configuring Meta Webhooks
1. In the App Dashboard, go to **WhatsApp > Configuration**.
2. Under **Webhook**, click **Edit**.
3. Set **Callback URL** to: `https://your-public-domain.com/api/webhooks/whatsapp` (or your Ngrok URL).
4. Set **Verify Token** to: the value matching `WHATSAPP_VERIFY_TOKEN` (e.g. `flowdesk_verify_token`).
5. Click **Verify and save**. Meta will trigger a GET request to verify the server signature.
6. Scroll down to **Webhook fields** and click **Manage**.
7. Subscribe to the **messages** field.

---

## 4. Hardening and Security Features

- **HMAC-SHA256 Verification**: Every POST webhook from Meta is validated against the `WHATSAPP_APP_SECRET` using HMAC-SHA256 signature checking. If the header `X-Hub-Signature-256` fails timing-safe verification, it returns `401 Unauthorized`.
- **Deduplication / Replay Protection**: To prevent processing the same webhook event multiple times, a bounded in-memory sliding cache tracks unique Meta `message_id`s. Any duplicate events are recognized and immediately acknowledged with `200 OK` without database or AI re-runs.
- **Meta 5-Second Timeout Mitigation**: Meta expects webhooks to return `200 OK` under 5 seconds. To prevent timeouts during slow AI generations, the system immediately returns `200 OK` for valid Meta webhooks and performs database logging, Gemini analysis, and ticketing asynchronously in background processes.
- **Exponential Backoff Retry**: Outbound dispatches to Meta's message delivery endpoints and n8n triggers will retry up to 3 times (starting at a 500ms delay, doubling on failure) to protect against transient networking drops.

---

## 5. n8n Workflows Deployment

We include three importable workflow configurations inside the [workflows/](file:///Users/pawan/Projects/Flowdesk%20AI/workflows) folder:

1. **[Incoming Message Workflow](file:///Users/pawan/Projects/Flowdesk%20AI/workflows/whatsapp-incoming-workflow.json)**: Runs inside n8n to intercept incoming webhook payloads and forward them to FlowDesk AI.
2. **[Ticket Escalation Workflow](file:///Users/pawan/Projects/Flowdesk%20AI/workflows/whatsapp-escalation-workflow.json)**: Dispatches alerts and notifies on-call teams when ticket priority escalates.
3. **[Ticket Resolution Workflow](file:///Users/pawan/Projects/Flowdesk%20AI/workflows/whatsapp-resolution-workflow.json)**: Executes post-resolution tasks and cleanup upon support ticket closure.

### How to Import:
1. Log in to your n8n dashboard (e.g. `http://localhost:5678`).
2. Click **Workflows** > **Add Workflow** > **Create from scratch**.
3. In the top-right menu of the canvas, select **Import from File**.
4. Select one of the JSON files from the `workflows/` directory.
5. Review the nodes, verify path/webhooks match, and activate the workflow.
