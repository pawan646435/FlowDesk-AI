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

## Features (V3.0 Upgrades)
1. **Gemini WhatsApp Chatbot**: Automated support agent powered by Gemini 2.5 Flash that chats statefully with customers on WhatsApp using historical conversation logs.
2. **Stateful Sessioning**: Automatically tracks and maintains conversational context based on the sender's phone number. Resets resolved sessions when a customer initiates a new request.
3. **Automated Ticket Escalation**: If the AI detects a complex technical issue or high customer frustration, it automatically generates a ticket (`Source = WHATSAPP`), classifies metadata (priority, sentiment, category), and triggers n8n V2 escalations.
4. **Event-Driven Status Updates**: Triggers a WhatsApp notification back to the customer whenever an agent changes their ticket status (e.g. from Open to In-Progress or Resolved) in the support dashboard.
5. **WhatsApp Web Simulator**: A premium developer dashboard (`/tickets/whatsapp-simulator`) mimicking a phone interface to test real AI chat flows and webhooks locally without needing paid Twilio/Meta developer accounts or ngrok tunnels.
6. **WhatsApp Customer Inbox**: A complete omnichannel console (`/tickets/whatsapp-history`) to audit conversation timelines, view linked tickets, and allow human agents to manually chat with customers.

## Directory Structure
```text
├── prisma/
│   └── schema.prisma        # Database schema definitions (includes TicketSource, WhatsApp Conversations)
├── workflows/
│   └── auto-escalation-workflow.json  # Stateful n8n escalation workflow template
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
│   │   └── validation.ts    # Input Zod schemas
│   ├── services/
│   │   ├── ticket.service.ts   # Database CRUD, statistics & webhook dispatchers
│   │   ├── gemini.service.ts   # Unified Gemini API integration & fallback parser
│   │   ├── n8n.service.ts      # Webhook dispatch integrations
│   │   ├── whatsapp.service.ts # Stateful WhatsApp event coordinator
│   │   └── activity.service.ts # Activity logs query & writes
│   ├── auth.ts              # Database-bound NextAuth setup
│   ├── auth.config.ts       # Edge-compatible NextAuth providers
│   └── middleware.ts        # Edge-runtime route-guard middleware
├── .env.example             # Configuration settings template
└── package.json             # NPM dependencies & task runners
```

## Setup Instructions
1. Clone repository and run `npm install`.
2. Configure `.env` with Neon connection details, Google OAuth credentials, `GEMINI_API_KEY`, and n8n webhook URLs.
3. Configure WhatsApp integration environment variables:
   - `WHATSAPP_ACCESS_TOKEN`: Meta API access token (Use `"mock"` for local simulator testing)
   - `WHATSAPP_PHONE_NUMBER_ID`: Meta Phone ID (Use `"mock"` for local simulator testing)
   - `WHATSAPP_VERIFY_TOKEN`: Webhook verification token (Defaults to `"flowdesk_verify_token"`)
4. Push database schema: `npx prisma db push`.
5. Import `workflows/auto-escalation-workflow.json` into n8n and toggle to **Active**.
6. Start dev server: `npm run dev`.
7. Load `/tickets/whatsapp-simulator` in the browser to begin testing.

