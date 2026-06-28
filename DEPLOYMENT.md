# FlowDesk AI - Production Deployment Guide

This guide details the end-to-end steps to deploy FlowDesk AI to a production environment.

---

## 1. Google Cloud Console (OAuth 2.0 Setup)

To allow support agents to log into the FlowDesk dashboard securely:

1. Open the [Google Cloud Console Credentials Screen](https://console.cloud.google.com/apis/credentials).
2. Select or create a project.
3. Configure the **OAuth Consent Screen**:
   - Set User Type to **External**.
   - Fill in App Name (`FlowDesk AI`), support email, and developer contact details.
4. Create **Credentials** > **OAuth Client ID**:
   - Application Type: **Web application**.
   - Under **Authorized JavaScript Origins**, add:
     - `https://your-domain.vercel.app` (or your custom domain)
   - Under **Authorized Redirect URIs**, add:
     - `https://your-domain.vercel.app/api/auth/callback/google`
5. Click **Create** and copy the `Client ID` and `Client Secret` to your production environment variables.

---

## 2. Neon Database Configuration (PostgreSQL + pgvector)

FlowDesk AI uses Neon serverless PostgreSQL for state persistence and semantic vector search.

1. Sign up on [neon.tech](https://neon.tech/) and create a new project.
2. In the Neon Console SQL Editor, execute the following to enable the vector extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Copy the connection string. Make sure to use the **pooled connection string** (ends with `-pooler`) for production deployments to prevent serverless execution from exhausting PostgreSQL connection limits.
4. Set this as `DATABASE_URL` in your deployment environment.

---

## 3. Meta Developer Portal (WhatsApp Cloud API)

To route customer messages to the chatbot and deliver replies:

1. Open the [Meta Developer Dashboard](https://developers.facebook.com/).
2. Create a **Business app** type.
3. Scroll to **Add Products to App** and set up **WhatsApp**.
4. In the Meta Business Suite, navigate to **System Users**:
   - Create a System User, assign it to the WhatsApp assets, and generate a **Permanent Access Token**. (Do not use the temporary 24h token from the dashboard in production).
   - Set this as `WHATSAPP_ACCESS_TOKEN`.
5. Copy the **Phone Number ID** (`WHATSAPP_PHONE_NUMBER_ID`) and **App Secret** (`WHATSAPP_APP_SECRET`).
6. Set a custom verify token (e.g. a secure random string) and add it as `WHATSAPP_VERIFY_TOKEN`.
7. Click **WhatsApp > Configuration > Edit Webhooks**:
   - Callback URL: `https://your-domain.vercel.app/api/webhooks/whatsapp`
   - Verify Token: Matches the `WHATSAPP_VERIFY_TOKEN` env variable.
8. Under **Webhook fields**, click **Manage** and subscribe to **messages**.

---

## 4. Vercel Hosting (Next.js Application Deployment)

Deploy the Next.js serverless app on Vercel:

1. Log in to [Vercel](https://vercel.com/) and click **Add New > Project**.
2. Import your FlowDesk AI GitHub repository.
3. In the **Build and Command Settings**:
   - Build Command: `npx prisma generate && next build` *(Prisma generation must complete successfully before compiling Next.js to ensure type safety)*.
4. Configure the **Environment Variables**:
   - `DATABASE_URL`
   - `AUTH_SECRET` (Generate using `npx auth secret`)
   - `NEXTAUTH_URL` (`https://your-domain.vercel.app`)
   - `AUTH_GOOGLE_ID`
   - `AUTH_GOOGLE_SECRET`
   - `GEMINI_API_KEY`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_APP_SECRET`
   - `WHATSAPP_VERIFY_TOKEN`
   - `N8N_WEBHOOK_NEW_TICKET`
   - `N8N_WEBHOOK_ESCALATION`
   - `N8N_WEBHOOK_NEGATIVE_SENTIMENT`
   - `N8N_WEBHOOK_RESOLUTION`
   - `N8N_WEBHOOK_SLA_BREACH`
5. Click **Deploy**.

---

## 5. n8n Automation Engine Deployment

n8n acts as the secondary automation service orchestrating alert notifications.

### Local Development (Docker Compose)
1. Run local container:
   ```bash
   docker compose up -d
   ```
2. Open n8n console at `http://localhost:5678`.

### Production Deployment (Railway)
1. Deploy n8n using Railway's official managed **PostgreSQL-backed n8n template** (avoids SQLite single-write locking constraints).
2. Open n8n dashboard and select **Workflows > Import from File**.
3. Import the workflows inside the `workflows/` directory:
   - `new-ticket-workflow.json`
   - `high-priority-workflow.json`
   - `whatsapp-incoming-workflow.json`
   - `whatsapp-resolution-workflow.json`
   - `auto-escalation-workflow.json`
4. Set the imported webhooks to **Active**. Update your Vercel environment variables with the production n8n webhook URLs.

---

## 6. Troubleshooting

- **401 Unauthorized (WhatsApp outbound)**: Ensure the `WHATSAPP_ACCESS_TOKEN` has not expired (temporary tokens expire in 24 hours). Ensure the System User has been granted the `whatsapp_business_messaging` permissions in Meta Business settings.
- **PrismaClientInitializationError**: Neon database goes to sleep after 5 minutes of inactivity on free tier accounts. The serverless functions are configured with catch-retry mechanisms, but accessing the UI after hours might cause a brief 2-second sleep spin-up.
- **ReferenceError: DOMMatrix is not defined**: This is resolved in the codebase by polyfilling browser globals during PDF extraction. Ensure you are using our updated PDF pipeline.
