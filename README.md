# FlowDesk AI V2.0

FlowDesk AI is a modern, production-ready, AI-powered customer support platform. Supercharged with stateful n8n automation, real-time AI categorization, sentiment alerts, and intelligent support summaries.

## Tech Stack
* **Framework**: Next.js 15 (App Router with Server Components & Actions)
* **Language**: TypeScript
* **Styling**: Tailwind CSS v4 & custom glassmorphism utilities
* **Database & ORM**: PostgreSQL (Neon Serverless) with Prisma ORM
* **AI Engine**: Google Generative AI (Gemini 2.5 Flash API with Zod validation)
* **Automation**: n8n Workflow Automation (stateful webhook callbacks and HTTP polling)
* **Authentication**: Auth.js v5 (NextAuth) with Google OAuth 2.0
* **Validation**: Zod (type-safe validation schemas)

## Features (V2.0 Upgrades)
1. **Dashboard Redesign & Queue Page**: Replaced standalone High Priority metrics with **SLA Breached Tickets**. Added a dedicated ticket queue page (`/tickets/queue`) separating urgent (High/Critical) and standard (Medium/Low) support tickets.
2. **AI Ticket Categorization**: Automatically classifies ticket categories (`BILLING`, `TECHNICAL`, `REFUND`, `ACCOUNT_ACCESS`, `SUBSCRIPTION`, `GENERAL_INQUIRY`) via the Gemini API, with a robust rule-based fallback layer.
3. **AI Sentiment Analysis**: Evaluates customer sentiment (`POSITIVE`, `NEUTRAL`, `NEGATIVE`). Shows real-time sentiment distribution and a dynamic ratio-based **Trend Analysis Alert Box** on the dashboard.
4. **Negative Sentiment n8n Alert**: Automatically triggers a webhook call to n8n upon negative customer sentiment to notify customer success teams.
5. **AI Support Summary**: Generates a one-sentence summary, parses key issues, and suggests routing teams. Renders a copyable draft reply inside the agent detail view.
6. **Stateful n8n Auto-Escalation**: Triggers an n8n webhook on High/Critical tickets, waits 30 minutes, polls Next.js GET `/api/tickets/[id]` to verify if the ticket is still open, sends an SMTP alert email, and PATCHes the SLA breach status back to the database.
7. **Dual Priority Tracking**: Tracks customer-selected `userPriority` and objective `aiPriority` side-by-side to prevent priority manipulation.

## Directory Structure
```text
├── prisma/
│   └── schema.prisma        # Database schema definitions (including V2 properties)
├── workflows/
│   └── auto-escalation-workflow.json  # Stateful n8n escalation workflow template
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/        # Catch-all endpoint for Auth.js
│   │   │   └── tickets/     # GET/PATCH endpoints for n8n polling
│   │   ├── dashboard/       # Protected V2 dashboard views
│   │   ├── tickets/         # Ticket listings, details & priority queue routes
│   │   ├── login/           # Glassmorphic OAuth login screen
│   │   ├── layout.tsx       # Global layouts and styles
│   │   ├── page.tsx         # Landing page and marketing panels (v2.0)
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
3. Push database schema: `npx prisma db push`.
4. Import `workflows/auto-escalation-workflow.json` into n8n and toggle to **Active**.
5. Start dev server: `npm run dev`.
