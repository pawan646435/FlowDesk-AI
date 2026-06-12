# FlowDesk AI V3.0 (WhatsApp Support Channel)

FlowDesk AI is a modern, production-ready, AI-powered customer support platform. Supercharged with stateful n8n automation, real-time AI categorization, sentiment alerts, and intelligent support summaries, and now fully integrated with an automated **WhatsApp Support Channel**.

## Tech Stack
* **Framework**: Next.js 15 (App Router with Server Components & Actions)
* **Language**: TypeScript
* **Styling**: Tailwind CSS v4 & custom glassmorphism utilities
* **Database & ORM**: PostgreSQL (Neon Serverless) with Prisma ORM
* **AI Engine**: Google Generative AI (Gemini 2.5 Flash API with Zod validation)
* **Automation**: n8n Workflow Automation (stateful webhook callbacks and HTTP polling)
* **Authentication**: Auth.js v5 (NextAuth) with Google OAuth 2.0
* **Validation**: Zod (type-safe validation schemas)

### Features (V3.0 Hardened & Omnichannel Upgrades)
1. **Gemini WhatsApp Chatbot**: Automated support agent powered by Gemini 2.5 Flash that chats statefully with customers on WhatsApp using historical conversation logs.
2. **Stateful Sessioning**: Automatically tracks and maintains conversational context based on the sender's phone number. Resets resolved sessions when a customer initiates a new request.
3. **Automated Ticket Escalation**: If the AI detects a complex technical issue or high customer frustration, it automatically generates a ticket (`Source = WHATSAPP`), classifies metadata (priority, sentiment, category), and triggers n8n V2 escalations.
4. **Event-Driven Status Updates**: Triggers a WhatsApp notification back to the customer whenever an agent changes their ticket status (e.g. from Open to In-Progress or Resolved) in the support dashboard.
5. **Webhook Security & Verification**: Implements secure HMAC-SHA256 signature verification (`X-Hub-Signature-256` validated against `WHATSAPP_APP_SECRET`) to ensure payload integrity and block forged webhook requests.
6. **Meta 5-Second Timeout Mitigation**: Responds with `200 OK` immediately under 200ms and schedules all heavy operations (Gemini AI, ticketing, n8n webhooks) to run asynchronously in a background worker.
7. **Idempotency Protection**: Leverages a bounded in-memory sliding-window cache to detect and automatically ignore duplicate Meta webhook deliveries.
8. **Outbound Retry Policy**: Outbound WhatsApp dispatches and n8n webhook triggers are wrapped in an exponential backoff retry handler (max 3 retries, starting at 500ms delay).
9. **WhatsApp Web Simulator**: A premium developer dashboard (`/tickets/whatsapp-simulator`) mimicking a phone interface to test real AI chat flows and webhooks locally without needing paid Twilio/Meta developer accounts or ngrok tunnels.
10. **WhatsApp Customer Inbox**: A complete omnichannel console (`/tickets/whatsapp-history`) to audit conversation timelines, view linked tickets, and allow human agents to manually chat with customers.

## Directory Structure
```text
├── docs/
│   └── whatsapp-business-setup.md   # Setup guide for Meta Developer Portal, webhook routing & n8n
├── scripts/
│   └── test-whatsapp-flow.ts        # Integration test script for verifying API endpoints & DB
├── prisma/
│   └── schema.prisma        # Database schema definitions (includes TicketSource, WhatsApp Conversations)
├── workflows/
│   ├── whatsapp-incoming-workflow.json     # Intercepts incoming events and forwards to backend
│   ├── whatsapp-resolution-workflow.json   # Handles ticket resolutions and session closure
│   ├── high-priority-workflow.json         # Directs on-call alerts for high-priority tickets
│   ├── auto-escalation-workflow.json       # original n8n escalation template
│   └── new-ticket-workflow.json            # original n8n new ticket log template
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/        # Catch-all endpoint for Auth.js
│   │   │   ├── tickets/     # GET/PATCH endpoints for n8n polling
│   │   │   └── webhooks/whatsapp/  # Verification (GET) and incoming event (POST) webhook route
│   │   ├── dashboard/       # Protected support dashboard views
│   │   ├── tickets/         # Ticket listings, details, queues, and WhatsApp views
│   │   │   ├── whatsapp-simulator/  # Web-based local WhatsApp phone simulator
│   │   │   ├── whatsapp-history/    # Customer Inbox and chat transcript auditer
│   │   │   └── whatsapp-actions.ts  # Server actions for WhatsApp management
│   │   ├── login/           # Glassmorphic OAuth login screen
│   │   ├── layout.tsx       # Global layouts and styles
│   │   ├── page.tsx         # Landing page and marketing panels
│   │   └── globals.css      # Core styles & Tailwind imports
│   ├── components/
│   │   ├── navbar.tsx       # Responsive layout header
│   │   ├── providers.tsx    # Global React contexts
│   │   ├── create-ticket-dialog.tsx # Native HTML dialog modal
│   │   └── status-dropdown.tsx     # Status transitions with useTransition
│   ├── lib/
│   │   ├── prisma.ts        # PrismaClient connection singleton
│   │   ├── config.ts        # Startup environment configuration schema validation
│   │   └── validation.ts    # Input Zod schemas
│   ├── services/
│   │   ├── ticket.service.ts   # Database CRUD, statistics & webhook dispatchers
│   │   ├── gemini.service.ts   # Unified Gemini API integration & fallback parser
│   │   ├── n8n.service.ts      # Webhook dispatch integrations with exponential retries
│   │   ├── whatsapp.service.ts # Stateful WhatsApp coordinator with retry policies
│   │   └── activity.service.ts # Activity logs query & writes
│   ├── auth.ts              # Database-bound NextAuth setup
│   ├── auth.config.ts       # Edge-compatible NextAuth providers
│   └── middleware.ts        # Edge-runtime route-guard middleware
├── .env.example             # Configuration settings template
└── package.json             # NPM dependencies & task runners
```

## Setup & Verification

For detailed instructions on configuring the WhatsApp Business API, webhooks, and n8n triggers, please follow the **[WhatsApp Business API Setup Guide](file:///Users/pawan/Projects/Flowdesk%20AI/docs/whatsapp-business-setup.md)**.

### Running Integration Tests:
To test the whole integration flow locally (incoming webhooks, signature checking, idempotency, ticket resolution):
```bash
# 1. Start the Next.js dev server:
npm run dev

# 2. Run the integration test suite:
npx tsx scripts/test-whatsapp-flow.ts
```

