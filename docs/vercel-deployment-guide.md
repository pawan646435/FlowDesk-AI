# FlowDesk AI - Vercel Deployment Guide

This guide details how to deploy FlowDesk AI (Next.js 15, Prisma ORM, PostgreSQL, Gemini, and n8n) on Vercel. Because Next.js is a full-stack framework, deploying it to Vercel deploys both your **frontend UI** and your **serverless backend API routes / Server Actions** simultaneously.

---

## 📋 Prerequisites

Before deploying, ensure you have:
1. **GitHub Account**: The FlowDesk AI repository must be pushed to a GitHub repository.
2. **Neon Console Access**: An active PostgreSQL serverless database URL.
3. **Google Developer Console Credentials**: Valid OAuth client ID and client secret.
4. **Google Gemini API Key**: Valid API key from Google AI Studio.
5. **WhatsApp credentials**: Meta Business Portal verify tokens, phone IDs, and App secret.

---

## 🛠️ Step-by-Step Deployment

### Step 1: Link Repository to Vercel
1. Log in to the [Vercel Dashboard](https://vercel.com).
2. Click **Add New** > **Project**.
3. Import your FlowDesk AI GitHub repository.

### Step 2: Configure Build & Development Settings
Under the **Build and Command Settings**:
- **Framework Preset**: Next.js
- **Root Directory**: `./` (or leave default)
- **Build Command**: Set this to run Prisma generation before building Next.js:
  ```bash
  npx prisma generate && next build
  ```
  *(Important: Next.js compilation requires the generated Prisma Client to pass TypeScript type-checking).*
- **Output Directory**: `.next`

### Step 3: Add Environment Variables
Add the following keys under the **Environment Variables** section:

| Category | Key | Value / Format | Description |
| :--- | :--- | :--- | :--- |
| **Database** | `DATABASE_URL` | `postgresql://...` | Neon database connection URL (use connection pooling URL for serverless). |
| **Auth** | `AUTH_SECRET` | `your-32-byte-secret` | Generated secret (run `npx auth secret` or generate random hex). |
| | `NEXTAUTH_URL` | `https://your-vercel-domain.vercel.app` | Your Vercel production URL (must match the assigned Vercel domain). |
| **OAuth** | `AUTH_GOOGLE_ID` | `xxxx.apps.googleusercontent.com` | Google OAuth Client ID. |
| | `AUTH_GOOGLE_SECRET` | `GOCSPX-xxxx` | Google OAuth Client Secret. |
| **AI** | `GEMINI_API_KEY` | `AIzaSy...` | Gemini API Key from Google AI Studio. |
| **WhatsApp** | `WHATSAPP_ACCESS_TOKEN` | `EAAC...` | Permanent Meta System User Token. |
| | `WHATSAPP_PHONE_NUMBER_ID`| `104505886392019` | Unique Meta Developer Phone ID. |
| | `WHATSAPP_BUSINESS_ACCOUNT_ID` | `109825475304918` | WhatsApp Business Account ID. |
| | `WHATSAPP_VERIFY_TOKEN` | `your-chosen-token` | Verification token matched with Meta Developer Portal setup. |
| | `WHATSAPP_APP_SECRET` | `32-char-hex-secret` | Meta App Secret (Crucial for HMAC-SHA256 signature verification). |
| **n8n** | `N8N_WEBHOOK_NEW_TICKET` | `https://n8n-domain/webhook/...` | Target URL in n8n for new tickets. |
| | `N8N_WEBHOOK_ESCALATION` | `https://n8n-domain/webhook/...` | Target URL in n8n for high priority escalations. |
| | `N8N_WEBHOOK_NEGATIVE_SENTIMENT` | `https://n8n-domain/webhook/...` | Target URL in n8n for negative sentiment. |
| | `N8N_WEBHOOK_RESOLUTION` | `https://n8n-domain/webhook/...` | Target URL in n8n for resolved tickets. |

*Note: In Vercel, set `NODE_ENV` to `production` by default.*

### Step 4: Click Deploy
Click **Deploy** and wait for the build logs to finish. Once completed, Vercel will assign a production URL (e.g. `https://flowdesk-ai.vercel.app`).

---

## 🔄 Post-Deployment Configuration

### 1. Update Google OAuth Authorized Redirect URIs
To prevent login errors (`redirect_uri_mismatch`), update the Google Developer Console:
1. Go to [Google API Console > Credentials](https://console.cloud.google.com/apis/credentials).
2. Select your OAuth 2.0 Client ID.
3. Add the Vercel production URL to **Authorized JavaScript origins**:
   `https://your-vercel-domain.vercel.app`
4. Add the OAuth callback route to **Authorized redirect URIs**:
   `https://your-vercel-domain.vercel.app/api/auth/callback/google`

### 2. Update Meta Webhooks Callback URL
To route live customer messages to your new deployment:
1. Navigate to the [Meta Developer App Dashboard](https://developers.facebook.com/).
2. Select your app, and click **WhatsApp > Configuration**.
3. Under **Webhook**, click **Edit**.
4. Update the **Callback URL** to point to your live Vercel endpoint:
   `https://your-vercel-domain.vercel.app/api/webhooks/whatsapp`
5. Ensure the verify token matches your `WHATSAPP_VERIFY_TOKEN`.

### 3. Update n8n Workflows
Verify that your active **Incoming Message Workflow** in n8n forwards payloads to the new production URL:
- Open the n8n HTTP Request node and edit the Request URL target:
  `https://your-vercel-domain.vercel.app/api/webhooks/whatsapp`

---

## ⚠️ Serverless Deployment Considerations

- **Cold Starts**: Serverless functions may experience a brief "cold start" delay if they have not been run recently. The backend endpoints handle database initialization singlets to minimize this.
- **Max Execution Timeout**: By default, Vercel Serverless Functions have a 10-second timeout limit on Hobby accounts. Since Meta webhooks demand an HTTP `200 OK` response within 5 seconds, our webhook route immediately acknowledges Meta webhooks (under 200ms) and uses Next.js `NextRequest.waitUntil` to complete AI processing in the background asynchronously. This ensures Vercel execution persists up to the system limit without blocking Meta.
- **Neon Connection Limits**: Ensure your `DATABASE_URL` utilizes connection pooling (e.g., Neon's pooled connection strings ending with `-pooler`) to prevent serverless scalability from saturating database connection limits.
