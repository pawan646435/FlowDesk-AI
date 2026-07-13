# FlowDesk AI — Project Report

*Compiled by direct inspection of the codebase at `/Users/pawan/Projects/Flowdesk AI` on 2026-07-13. Current branch `main`, latest commit `c650f98`.*

---

## 1. Project Overview

**FlowDesk AI** is a single-tenant, AI-powered customer support / helpdesk platform built as a Next.js 15 monolith. It combines:

- A classic web ticketing system (create/view/triage support tickets, agent dashboard, SLA tracking).
- A **WhatsApp Business channel** where an AI agent (Google Gemini) autonomously converses with customers, answers self-service questions using a RAG knowledge base, and escalates to a human-agent ticket when needed.
- An **SLA engine** that auto-calculates response/resolution deadlines per ticket priority and flags breaches.
- A **Knowledge Base / RAG pipeline** (pgvector + Gemini embeddings) that grounds AI replies in uploaded org documents (PDF/DOCX/TXT).
- **n8n** as an external, decoupled automation layer for notifications (new ticket, escalation, negative sentiment, resolution, SLA breach) — email/Slack/PagerDuty-style alerting, kept out of the critical request path.

**Problem it solves:** Small support teams get overwhelmed by manual ticket triage (category/priority/sentiment tagging), miss SLA deadlines, and can't offer 24/7 conversational support on channels like WhatsApp without hiring more agents. FlowDesk AI automates triage and first-line WhatsApp responses with an LLM, while keeping humans in the loop for anything the AI can't confidently resolve.

**Who it's for:** Support/CS teams at a small-to-mid-size company (SaaS-style: billing, refunds, technical issues, account access, subscriptions) who want an AI-first omnichannel desk without standing up a full CX platform like Zendesk/Intercom.

**Core value proposition:** "Zero-effort triage + always-on WhatsApp support agent + enforced SLA discipline," built on a lean, mostly-serverless stack (Next.js on Vercel + Neon Postgres + Gemini), with n8n handling notification fan-out so the core app stays fast and simple.

The product is pre-revenue / demo-stage — there's a `/tickets/test-escalation` sandbox page and a `/tickets/whatsapp-simulator` page purpose-built for manually testing the AI+webhook flows without real WhatsApp/Meta credentials, which signals this is still in active development/demo mode rather than live production use.

---

## 2. Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Framework | Next.js (App Router) | `15.5.19`, using Turbopack for dev (`next dev --turbopack`) |
| Language | TypeScript | `^5`, but `next.config.ts` sets `typescript.ignoreBuildErrors: true` (see §6) |
| UI | React | `19.1.0` / `react-dom 19.1.0` |
| Styling | Tailwind CSS | `v4` (via `@tailwindcss/postcss`), custom "glass" / dark-mode styling in `globals.css` |
| Icons | `lucide-react` | `^1.17.0` |
| Validation | Zod | `^4.4.3` — used for both env config (`src/lib/config.ts`) and form/API payloads (`src/lib/validation.ts`), and to validate Gemini's structured JSON output |
| ORM | Prisma | `^6.19.3` (`@prisma/client` same) |
| Database | **Neon serverless PostgreSQL** with the `pgvector` extension | Vector column defined via Prisma `Unsupported("vector(3072)")` |
| Auth | **Auth.js v5 (NextAuth beta)** | `next-auth@^5.0.0-beta.25` + `@auth/prisma-adapter@^2.11.2`, Google OAuth only, JWT session strategy |
| AI / LLM | **Google Generative AI SDK** (`@google/generative-ai@^0.24.1`) | Chat/classification model: `gemini-2.5-flash`; embeddings model: `gemini-embedding-001` (3072-dim vectors) |
| Document parsing | `pdf-parse@^2.4.5` (PDF), `unzip` shell command + XML strip (DOCX), native `fs.readFileSync` (TXT) |
| Automation | **n8n** (external service, not in this repo except JSON workflow exports) | Invoked purely via outbound webhooks (fire-and-forget HTTP POST with retry) |
| Messaging channel | **Meta WhatsApp Cloud API** | `graph.facebook.com/v17.0/{phoneId}/messages`, HMAC-SHA256 signed webhooks |
| Deployment target | **Vercel** (per `DEPLOYMENT.md`) | Build command: `prisma generate && next build` |
| Local n8n hosting | Docker Compose (`docker-compose.yml`) for dev, Railway (Postgres-backed n8n template) for prod |
| No cache layer | — | No Redis/Memcached; "caching" for webhook idempotency is a bounded in-memory `Set` (see §6, resets on redeploy/cold start — a real gap in serverless) |

**No dedicated component library** (no shadcn/Radix/MUI) — all UI is hand-rolled Tailwind with `lucide-react` icons.

---

## 3. Architecture

**Shape:** A single Next.js app doing triple duty as: server-rendered dashboard UI, REST-ish API route handlers (`src/app/api/**`), and background-processing host (via `NextRequest.waitUntil` for async work). It's a monolith/monorepo (one `package.json`, no workspace tooling) — not split into frontend/backend repos.

**Data flow for WhatsApp (the core flow), verified in `src/app/api/webhooks/whatsapp/route.ts` and `src/services/whatsapp.service.ts`:**

1. Meta POSTs to `/api/webhooks/whatsapp`. HMAC-SHA256 signature is checked against `WHATSAPP_APP_SECRET` (`crypto.timingSafeEqual`); production requests without a signature header are rejected (dev/simulator requests are exempted via an `isSimulator` flag).
2. An in-memory `Set` + array (`processedMessageIds`, capped at 2000 entries) provides duplicate-webhook-retry suppression by Meta's message ID.
3. Two execution paths diverge on `isSimulator`:
   - **Simulator requests** (from the `/tickets/whatsapp-simulator` UI, which POSTs directly to the webhook with `{phoneNumber, text}`) run `handleIncomingWhatsAppMessage` **synchronously** and return the AI reply in the HTTP response — needed so the simulator UI can show it live.
   - **Real Meta webhook requests** call the same function but don't `await` it inline — they attach it to `request.waitUntil()` (Next.js/Vercel's background-execution API) so the route can return `200 OK` immediately, honoring Meta's 5-second webhook timeout.
4. `handleIncomingWhatsAppMessage` (in `whatsapp.service.ts`) does: find-or-create `WhatsAppConversation` → persist inbound message → if conversation is already `ESCALATED`, short-circuit with a canned "an agent will follow up" reply (Gemini is *not* invoked again) → otherwise call `analyzeWhatsAppMessage` (Gemini).
5. `analyzeWhatsAppMessage` (in `gemini.service.ts`) first runs the RAG retrieval step inline (embed the incoming text → `searchSimilarity` against `DocumentChunk` via raw SQL cosine distance `<=>`), logs a `RAG_RETRIEVAL:` activity record for analytics, then calls Gemini with a JSON-schema-constrained prompt that decides `needsEscalation` and drafts a reply.
6. If escalation is needed: a `Ticket` is created, the `WhatsAppConversation` is flipped to `ESCALATED` and linked to it, `Activity` audit rows are written, and three n8n webhooks (`new-ticket`, `escalation` if HIGH/CRITICAL, `negative-sentiment` if sentiment is negative) are fired in a detached async IIFE — explicitly *not* awaited by the main response path, so a slow/down n8n instance can't block the customer reply.
7. The reply is sent back via `sendWhatsAppMessage`, which persists the outbound message and — if real Meta credentials are configured (not the literal string `"mock"`) — calls the Graph API with exponential-backoff retry; otherwise it just logs a `[MOCK OUTGOING]` line, letting the whole pipeline run without real WhatsApp credentials.

**Web ticket creation flow** (`src/services/ticket.service.ts::createTicket`) is simpler and synchronous: call Gemini for classification → compute SLA deadlines → single Prisma `create` + two `Activity` creates → fire n8n webhooks in a detached background IIFE, same non-blocking pattern as above.

**RAG ingestion** (`src/services/knowledge.service.ts`): file uploaded via `/api/knowledge-base` (multipart) → saved to `./tmp/` → `KnowledgeDocument` row created as `PENDING` → background promise (`waitUntil` if available, else fire-and-forget) parses text (format-specific extractor), chunks it (1000 chars / 200 overlap sliding window), and **sequentially** (not batched/parallel) creates a `DocumentChunk` row + generates its embedding + `UPDATE ... SET embedding` via raw SQL for each chunk, then flips document status to `INDEXED` or `FAILED`. Temp file is deleted in a `finally` block regardless of outcome.

**Notable architectural decisions:**
- **Sync vs async split is deliberate and consistent**: anything on the "must respond fast" path (webhook ack, ticket creation DB write) is synchronous; anything external/slow (n8n calls, WhatsApp Graph API sends via retry, RAG indexing) is pushed to detached promises or `waitUntil`.
- **No message queue** — "background work" is just unawaited promises + Vercel's `waitUntil`, which is fine for short-lived tasks but has no persistence/retry guarantee if the serverless instance is killed mid-flight (see §6).
- **RAG storage is raw SQL, not Prisma-native** — because Prisma's schema-level `vector` type support is limited, all embedding writes/reads go through `prisma.$executeRawUnsafe` / `$queryRawUnsafe` string-interpolating the vector as a `[0.1,0.2,...]` literal cast to `::vector`. This is **not parameterized for the vector value itself in the same way scalar values are** — worth a security look (see §6).
- **n8n is treated as an untrusted, best-effort sink**: every trigger function returns `{success, status, data, error}` rather than throwing, and callers wrap calls in `try/catch` that only log — a ticket/WhatsApp flow never fails because n8n is down.
- **Single global "system user"**: WhatsApp-originated tickets/activities are attributed to `prisma.user.findFirst()` (creating one named "System Agent" if none exists) rather than a real agent — there's no per-agent WhatsApp handling model yet.
- **Auth boundary**: `middleware.ts` gates `/dashboard` and `/tickets` behind Auth.js session cookies; `/api/**` routes each do their own `auth()` check inline (no centralized API middleware), and the WhatsApp webhook and SLA-check endpoints are intentionally unauthenticated (they're meant to be called by Meta/cron, protected instead by HMAC signature / obscurity).

---

## 4. Features Implemented So Far

### 4.1 Google OAuth Authentication — **Done**
- `src/auth.ts` / `src/auth.config.ts`: Auth.js v5 with `PrismaAdapter`, Google provider only, `prompt: "select_account"` forced. JWT session strategy; user `id` propagated into the JWT/session in callbacks.
- `middleware.ts` protects `/dashboard*` and `/tickets*`; unauthenticated users are redirected to `/login`, and logged-in users hitting `/login` are redirected to `/dashboard`.

### 4.2 Web Ticket Management — **Done**
- Create ticket (`src/components/create-ticket-dialog.tsx` + `src/app/tickets/actions.ts::createTicketAction`, a Next.js Server Action) with Zod-validated title/description and an `isHighPriority` checkbox that sets a separate `userPriority` field (distinct from AI-derived `aiPriority`).
- List/detail views: `src/app/tickets/page.tsx`, `src/app/tickets/[id]/page.tsx` (238 lines — shows activity timeline, AI summary, suggested reply, status dropdown).
- Status transitions (`OPEN → IN_PROGRESS → RESOLVED`) via `status-dropdown.tsx` calling `updateTicketStatusAction`; marks `firstResponseMet = true` on any non-OPEN transition, and on `RESOLVED` fires the resolution n8n webhook and — if the ticket has a linked WhatsApp conversation — sends the customer a WhatsApp status update and resets that conversation to `RESOLVED`.
- **Operational Queue view** (`/tickets/queue`): non-resolved tickets split into "Critical & High Urgency" vs "Standard & Low Priority" sections, each ticket card showing priority/category/status/SLA-breach/source badges.

### 4.3 AI Ticket Triage (Gemini) — **Done, with fallback**
- `src/services/gemini.service.ts::analyzeTicket`: sends title+description to `gemini-2.5-flash` with a `responseSchema` (JSON mode) requesting `category`, `priority`, `sentiment`, `suggestedReply`, `aiSummary`, `keyIssues`, `recommendedTeam`. Output is Zod-validated before use.
- **Rule-based fallback**: if `GEMINI_API_KEY` is unset/placeholder, or if the Gemini call/JSON-parse/Zod-validation throws, a deterministic keyword-matching classifier (`getRuleBasedFallback`) runs instead — the app never fails to classify a ticket, it just degrades gracefully. This fallback is real, tested logic, not a stub.

### 4.4 WhatsApp Conversational AI Agent — **Done**
- Stateful conversation model (`WhatsAppConversation` + `WhatsAppMessage`) keyed by phone number, with states `ACTIVE / ESCALATED / RESOLVED`.
- `analyzeWhatsAppMessage` decides escalation vs. self-service reply, grounding replies in RAG context when available, and drafts ticket metadata inline when escalating — all in one Gemini call (dual-purpose classify+reply+ticket-draft), also with a keyword-based fallback (`getFallbackWhatsAppAnalysis`) when Gemini/API key is unavailable.
- Escalated conversations bypass the LLM entirely on subsequent messages (cost/latency optimization + prevents an "escalated" customer being told to self-serve again).
- **WhatsApp Simulator UI** (`/tickets/whatsapp-simulator`, `src/app/tickets/whatsapp-simulator/page.tsx`, 438 lines): a fake-phone-mockup chat UI that POSTs to the real webhook endpoint with `{phoneNumber, customerName, text}}` — full dev/demo tool for exercising the AI without Meta credentials, including quick-scenario buttons ("self-service," "escalate," "force escalation") and a session-reset action.
- **WhatsApp History / Inbox** (`/tickets/whatsapp-history`, `src/app/tickets/whatsapp-actions.ts`): agent-facing view of conversations, with a manual "send as AGENT" reply action (`sendManualAgentReply`) — so a human can take over an escalated chat directly from the dashboard.

### 4.5 SLA Engine — **Done**
- `src/services/sla.service.ts::calculateSLADeadlines`: LOW = 4h/24h, MEDIUM = 1h/4h, HIGH/CRITICAL = 15m/1h (response/resolution). Computed at ticket-creation time and stored as `firstResponseDueAt` / `resolutionDueAt`.
- `checkSLABreaches`: queries tickets that are unresolved, not yet flagged breached, and past either deadline; marks `slaBreached = true`, logs an `Activity`, and fires the SLA-breach n8n webhook. **Exposed via `GET /api/tickets/sla-check`** — this is meant to be hit by an external cron (Vercel Cron, GitHub Actions, etc.), but **no scheduler is configured in this repo** (no `vercel.json` cron block found) — it currently has to be triggered manually or externally.
- Dashboard SLA metrics (`getSLADashboardStats`): active SLA count, breached count, compliance rate (% of resolved tickets that didn't breach), average response time computed from the first non-system `Activity` after ticket creation.

### 4.6 Knowledge Base / RAG Pipeline — **Done**
- Upload UI (`/dashboard/knowledge-base`, 427 lines) supporting `.txt/.pdf/.docx`, with live polling (every 2s, up to 10 attempts) for indexing status.
- Extraction: `.txt` via `fs.readFileSync`; `.pdf` via `pdf-parse`'s `PDFParse` class with `disableWorker: true` and a manual `DOMMatrix` polyfill (needed because `pdf-parse` expects browser globals that don't exist in Next.js's server runtime — see commit history, this took 4 commits to stabilize); `.docx` via shelling out to `unzip -p file word/document.xml` and stripping tags, with a raw-binary-scan fallback if `unzip` isn't available.
- Chunking: 1000-char windows, 200-char overlap, whitespace-normalized.
- Embeddings via `gemini-embedding-001` (3072-dim), written with raw SQL `UPDATE ... SET embedding = $1::vector`.
- Similarity search: cosine distance (`<=>` operator) via raw SQL, `1 - distance AS similarity`, configurable threshold/limit — used at 0.7 threshold for live WhatsApp grounding and 0.5 for the manual "Semantic Similarity Search Test" panel in the KB dashboard.
- KB stats + RAG analytics (retrieval requests, successful retrievals, fallback count, avg similarity) are computed by parsing `Activity` log strings with regex (`ChunksFound=`, `AvgSimilarity=`) rather than a dedicated metrics table — functional but fragile (see §6).
- Document delete cascades to chunks via Prisma's `onDelete: Cascade`.

### 4.7 n8n Automation Integration — **Done (webhook side); n8n itself is external**
- `src/services/n8n.service.ts` provides 5 typed trigger functions (new ticket, escalation, negative sentiment, resolution, SLA breach), each POSTing a small JSON payload with 3-attempt exponential-backoff retry, and defensive parsing of n8n's response (handles empty/non-JSON bodies — commit `19108c8` specifically fixed this).
- 5 importable n8n workflow JSON files ship in `workflows/` (`new-ticket-workflow.json`, `high-priority-workflow.json`, `whatsapp-incoming-workflow.json`, `whatsapp-resolution-workflow.json`, `auto-escalation-workflow.json`) — these define the *n8n side* (e.g., SMTP/Brevo email sending) and are not executed by this codebase, only imported into a separate n8n instance.
- `/tickets/test-escalation` page: a dev sandbox that fires a synthetic HIGH-priority escalation payload straight at the configured n8n webhook URL and shows the raw response — for verifying SMTP/Brevo wiring without touching the database.

### 4.8 Dashboard / Analytics — **Done**
- `src/app/dashboard/page.tsx` (459 lines): ticket counts by status, SLA metrics, category breakdown, sentiment distribution with a derived "trend analysis" alert (>30% negative = red alert copy, >10% = amber warning, else green), WhatsApp channel stats (sessions / tickets-via-WhatsApp / tickets-via-Web), recent tickets list, and an activity timeline.

### 4.9 Landing Page — **Done**
- `src/app/page.tsx`: marketing/landing page (not gated by auth) with a feature grid (WhatsApp channel, Gemini agent, n8n automation, Google auth) and a CTA that routes to `/dashboard` or `/login` depending on session state.

### 4.10 Env/Config Validation — **Partially done / dead code**
- `src/lib/config.ts` defines a Zod schema for required env vars and calls `validateConfig()` at module load (throwing in production if vars are missing). **However, grep confirms this module is never imported anywhere in `src/`** — it's currently inert; env validation doesn't actually run unless something imports it.

---

## 5. Data Models / Schema

All in `prisma/schema.prisma`, PostgreSQL via Neon with `pgvector`.

**Auth (Auth.js standard tables):**
- `User` (`id, name, email, image, ...`) — 1:N with `Account`, `Session`, `Ticket`, `Activity`.
- `Account`, `Session`, `VerificationToken` — standard NextAuth/Prisma-adapter shape.

**Ticketing core:**
- `Ticket` — belongs to `User` (`userId`, cascade delete). Fields of note:
  - Dual/triple priority tracking: `priority` (effective), `userPriority` (what the human requester flagged), `aiPriority` (what Gemini assigned) — `priority` is currently always set equal to `aiPriority` at creation (see §8, open question).
  - AI outputs stored directly on the ticket: `category`, `sentiment`, `suggestedReply`, `aiSummary`, `keyIssues` (comma-separated string, not a relation/array), `recommendedTeam` (free text, not an enum).
  - SLA fields: `slaBreached`, `firstResponseDueAt`, `resolutionDueAt`, `firstResponseMet`, `breachedAt`, `escalatedAt`.
  - `source: TicketSource` (`WEB | WHATSAPP`).
  - 1:1 optional with `WhatsAppConversation`.
  - Indexed on `userId, priority, aiPriority, slaBreached, source, firstResponseDueAt, resolutionDueAt`.
- `Activity` — append-only audit/timeline log (`action: String` free text), belongs to both `Ticket` and `User`. Used both as a genuine audit trail *and* (ab)used as an analytics data source (RAG stats, SLA breach stats) via string parsing — no structured metrics table exists.
- Enums: `TicketStatus (OPEN/IN_PROGRESS/RESOLVED)`, `TicketCategory` (8 values — note `DELIVERY` and `ACCOUNT` exist in the enum/webhook payload types but are **never produced** by either Gemini prompt, which only ever emits 6 of the 8), `TicketPriority (LOW/MEDIUM/HIGH/CRITICAL)`, `TicketSentiment (POSITIVE/NEUTRAL/NEGATIVE)`, `TicketSource (WEB/WHATSAPP)`.

**WhatsApp:**
- `WhatsAppConversation` — unique on `phoneNumber` (one active conversation per number, globally, not per-user — there's no multi-tenant separation). Optional 1:1 to `Ticket`. `status: WhatsAppConversationStatus (ACTIVE/ESCALATED/RESOLVED)`.
- `WhatsAppMessage` — belongs to `WhatsAppConversation`, `sender: MessageSender (CUSTOMER/AI/SYSTEM/AGENT)`, plain `text`.

**Knowledge Base / RAG:**
- `KnowledgeDocument` — `status: String` (not an enum, despite being effectively a 4-state machine: `PENDING/PROCESSING/INDEXED/FAILED`) — 1:N `DocumentChunk` with cascade delete.
- `DocumentChunk` — `content: String`, `embedding: Unsupported("vector(3072)")?` (nullable — chunks exist transiently without an embedding between creation and the async embed step), `chunkIndex: Int`.

**Relationship summary:**
```
User 1─N Ticket 1─1(optional) WhatsAppConversation 1─N WhatsAppMessage
User 1─N Activity N─1 Ticket
KnowledgeDocument 1─N DocumentChunk
```
Note: `Activity` and `Ticket` both hard-require a `userId` — this is why WhatsApp-originated tickets/activities get attributed to a synthetic "System Agent" user (§3) rather than left null.

---

## 6. Known Issues / Incomplete Work

Ranked roughly by how much they'd matter to a next engineer:

1. **Build errors are globally suppressed.** `next.config.ts` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` (commit `df91a69`, "Bypass ESLint/TypeScript build errors ... for Vercel compatibility"). This means the production build can currently ship with type errors or lint failures silently. Worth auditing `npx tsc --noEmit` and `npm run lint` directly since CI/build won't catch regressions.
2. **`src/lib/config.ts` (env validation) is dead code** — not imported anywhere, so its Zod-based startup validation never runs. If someone deploys with a missing env var, they'll get a runtime error deep in a service call instead of a clear startup failure.
3. **No cron/scheduler wired up for SLA breach checking.** `GET /api/tickets/sla-check` exists and works, but nothing in the repo (no `vercel.json`, no GitHub Action) actually calls it on a schedule — SLA breaches will never be detected unless something external is configured to hit that endpoint periodically.
4. **Webhook idempotency cache is in-memory and per-instance.** `processedMessageIds` in the WhatsApp webhook route is a `Set` living in the Node process. On Vercel serverless, each function invocation can run in a different (possibly cold) container, so duplicate-message suppression is unreliable in production — it only reliably works for retries that land on the same warm instance.
5. **Background work has no durability guarantee.** RAG indexing and n8n webhook dispatch rely on unawaited promises + `waitUntil`. If the serverless function is frozen/recycled mid-task (e.g., a large PDF taking longer than the platform's execution budget), the document can get stuck in `PROCESSING` forever with no retry/resume mechanism, and there's no dead-letter/retry queue for failed n8n dispatches beyond the initial 3 in-process retries.
6. **Sequential (not batched) embedding generation.** `processAndIndexDocument` awaits one `generateEmbedding` call per chunk in a `for` loop — for a large document this is slow and serially rate-limits against the Gemini API; no batching or `Promise.all`/concurrency limiting.
7. **RAG/SLA analytics are derived by regex-parsing `Activity.action` strings** (e.g. `RAG_RETRIEVAL: Query='...', ChunksFound=X, AvgSimilarity=Y`) rather than a real metrics table — fragile (a prompt/format change silently breaks analytics) and pollutes the ticket audit trail with synthetic system-log tickets (`"RAG & System Operations Log"`).
8. **Raw SQL vector interpolation.** `rag.service.ts` and `knowledge.service.ts` build vector literals via `` `[${embedding.join(",")}]` `` and pass them as a parameterized string to `$queryRawUnsafe`/`$executeRawUnsafe` — the vector itself is parameterized correctly (passed as `$1`), but the *use* of `RawUnsafe` variants throughout (vs. Prisma's safer `$queryRaw` tagged-template) is worth a second look if any other raw-SQL call sites ever interpolate user input directly.
9. **Ticket priority model is confusing/possibly redundant.** `Ticket.priority` is always set equal to `aiPriority` at creation time in `ticket.service.ts` and `whatsapp.service.ts`; `userPriority` (customer's self-reported urgency, from the "isHighPriority" checkbox) is stored but **never actually influences the effective `priority`** used for SLA calculation or queue sorting — it's write-only today. Needs a product decision (see §9).
10. **`TicketCategory` enum has two unreachable values** (`DELIVERY`, `ACCOUNT`) — defined in the schema and in the n8n webhook payload TypeScript union, but neither Gemini prompt (`analyzeTicket` or `analyzeWhatsAppMessage`) is instructed to ever emit them.
11. **`KnowledgeDocument.status` is an untyped `String`**, not a Prisma enum, despite behaving as a strict 4-value state machine (`PENDING/PROCESSING/INDEXED/FAILED`) — no compile-time safety against typos.
12. **Single global WhatsApp conversation per phone number, no multi-tenancy.** `WhatsAppConversation.phoneNumber` is globally unique — this app can't support multiple businesses/tenants sharing the platform; it's architecturally single-tenant.
13. **No automated test suite** in the CI sense — `scripts/test-sla-rag-flow.ts` and `scripts/test-whatsapp-flow.ts` are manual integration scripts (run via `npx tsx`) that hit a real database and real Gemini API; there's no unit test framework (Jest/Vitest) configured, and no CI workflow file found in the repo (no `.github/workflows/`).
14. **WHATSAPP_ACCESS_TOKEN mock-mode detection is a magic string check** (`token !== "mock"`) — fine for dev, but a subtle footgun if someone accidentally sets a real env var to the literal string `"mock"` in a way that's meant to be real, or vice versa.
15. **`.history/` directory present in the repo root** (VS Code Local History extension artifact) — untracked per `git status`, should probably be gitignored if not already (worth checking `.gitignore`).
16. **`.env` (with presumably-real secrets) exists in the working tree** — confirmed present with all keys set; ensure it's gitignored (not verified here, recommend a check before any push) and was never committed historically.

---

## 7. File / Folder Structure

```
Flowdesk AI/
├── .env                          # Local secrets (DATABASE_URL, GEMINI_API_KEY, WhatsApp/n8n creds — all set)
├── .env.example                  # Documented template with inline comments per var
├── ARCHITECTURE.md                # System design doc w/ Mermaid diagrams (matches implementation closely)
├── DEPLOYMENT.md                  # Step-by-step Vercel/Neon/Meta/n8n deployment guide
├── README.md                      # Overview, tech stack table, RAG/SLA explainer, repo layout
├── docker-compose.yml             # Local n8n container for dev
├── next.config.ts                 # ⚠️ ignoreBuildErrors + ignoreDuringBuilds both true
├── eslint.config.mjs              # next/core-web-vitals + next/typescript flat config
├── prisma/
│   └── schema.prisma               # All models (see §5)
├── scripts/
│   ├── test-sla-rag-flow.ts        # Manual integration test: SLA calc, breach engine, chunking, embeddings, RAG search
│   └── test-whatsapp-flow.ts       # Manual integration test: WhatsApp message handling flow
├── workflows/                      # n8n workflow exports (JSON), imported into a separate n8n instance
│   ├── auto-escalation-workflow.json
│   ├── high-priority-workflow.json
│   ├── new-ticket-workflow.json
│   ├── whatsapp-incoming-workflow.json
│   └── whatsapp-resolution-workflow.json
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts     # Auth.js handler mount
│   │   │   ├── knowledge-base/route.ts         # GET (list+stats) / POST (upload+index)
│   │   │   ├── knowledge-base/[id]/route.ts    # DELETE (cascade removes chunks)
│   │   │   ├── knowledge-base/search/route.ts  # POST — manual semantic search test endpoint
│   │   │   ├── tickets/[id]/route.ts           # GET/PATCH — used by n8n for status checks/escalation flag
│   │   │   ├── tickets/sla-check/route.ts      # GET — SLA breach sweep (needs external cron trigger)
│   │   │   └── webhooks/whatsapp/route.ts      # GET (Meta verify) / POST (inbound message handler)
│   │   ├── dashboard/
│   │   │   ├── page.tsx                        # Main analytics dashboard
│   │   │   └── knowledge-base/page.tsx         # KB upload/search/manage UI
│   │   ├── tickets/
│   │   │   ├── page.tsx / actions.ts           # List + create (Server Actions)
│   │   │   ├── [id]/page.tsx                   # Ticket detail
│   │   │   ├── queue/page.tsx                  # Priority-sorted operational queue
│   │   │   ├── test-escalation/page.tsx        # n8n webhook test sandbox
│   │   │   ├── whatsapp-simulator/page.tsx     # Fake-phone chat UI hitting the real webhook
│   │   │   ├── whatsapp-history/page.tsx       # Agent inbox for WhatsApp conversations
│   │   │   └── whatsapp-actions.ts             # Server Actions for WhatsApp conv management
│   │   ├── login/page.tsx                      # Google OAuth sign-in screen
│   │   ├── layout.tsx, page.tsx, globals.css   # Root layout, landing page, Tailwind theme
│   │   └── middleware.ts (at src/ root)        # Route-level auth gating
│   ├── components/                # navbar, create-ticket-dialog, status-dropdown, copy-button, providers
│   ├── services/                  # All business logic (see §3/§4) — the real "backend" layer
│   │   ├── gemini.service.ts        # Ticket + WhatsApp AI analysis, incl. fallbacks
│   │   ├── rag.service.ts           # Embeddings + pgvector similarity search + RAG analytics
│   │   ├── knowledge.service.ts     # Document parsing, chunking, ingestion pipeline
│   │   ├── sla.service.ts           # SLA deadline calc, breach sweep, dashboard stats
│   │   ├── ticket.service.ts        # Ticket CRUD, stats aggregation
│   │   ├── whatsapp.service.ts      # Inbound/outbound WhatsApp message orchestration
│   │   ├── n8n.service.ts           # Webhook dispatch w/ retry, 5 typed trigger functions
│   │   └── activity.service.ts      # Audit log create/read
│   ├── lib/
│   │   ├── prisma.ts                # PrismaClient singleton
│   │   ├── validation.ts            # Zod schemas for ticket create/update forms
│   │   ├── config.ts                # ⚠️ Env validation — currently unused/dead code
│   │   └── test-integration.ts
│   ├── auth.ts / auth.config.ts     # Auth.js setup (Google provider, Prisma adapter, JWT)
├── tmp/                            # Scratch dir for uploaded files pre-ingestion (cleaned up after processing)
└── public/                         # Static assets
```

---

## 8. Environment / Deployment Setup

**Hosting model (per `DEPLOYMENT.md`, consistent with code):**
- **App**: Vercel, Next.js serverless functions. Build command `prisma generate && next build` (Prisma client must be generated before the Next build compiles route handlers that import it — this is also now baked into `package.json`'s `build` script and a `postinstall` hook, per the latest commit `c650f98`).
- **Database**: Neon serverless Postgres with the `vector` extension manually enabled (`CREATE EXTENSION IF NOT EXISTS vector;`) — deployment doc explicitly calls out using the **pooled** connection string (`-pooler` suffix) for `DATABASE_URL` to avoid exhausting Postgres connections from serverless cold starts.
- **n8n**: run separately — Docker Compose locally, Railway (Postgres-backed template, to avoid SQLite locking issues) in production. Fully decoupled; the Next.js app only knows n8n's webhook URLs via env vars and never depends on n8n being reachable to function.
- **No CI/CD pipeline files found** (no `.github/workflows/`) — deployment is presumably manual `git push` → Vercel auto-deploy, or triggered directly from Vercel's dashboard.

**Environment variables required** (names only, from `.env.example` / `lib/config.ts` / `DEPLOYMENT.md` — all currently set in local `.env`):

| Category | Variables |
|---|---|
| Database | `DATABASE_URL` |
| Auth | `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXTAUTH_URL` |
| AI | `GEMINI_API_KEY` |
| WhatsApp / Meta | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET` |
| n8n webhooks | `N8N_WEBHOOK_NEW_TICKET`, `N8N_WEBHOOK_ESCALATION`, `N8N_WEBHOOK_NEGATIVE_SENTIMENT`, `N8N_WEBHOOK_RESOLUTION`, `N8N_WEBHOOK_SLA_BREACH` |

All WhatsApp/Meta vars can be set to the literal `"mock"` for local dev without a real Meta account — the app detects this and logs instead of calling the real Graph API.

---

## 9. Open Questions / Decisions Needed

1. **What should `Ticket.priority` actually be?** Right now it's silently always `aiPriority`. Is `userPriority` meant to ever override or blend with the AI's assessment (e.g., "if customer marks urgent AND AI agrees, escalate faster"), or should the field just be removed/relabeled as informational-only? This affects SLA deadline calculation, queue sorting, and n8n escalation triggers, all of which currently key off `priority` alone.
2. **Who staffs the SLA breach cron?** The breach-check endpoint exists but nothing calls it. Decide: Vercel Cron (`vercel.json`), a GitHub Action on a schedule, or an external uptime-monitor-style pinger — and at what interval (every minute? every 5?).
3. **Should `DELIVERY` and `ACCOUNT` categories be removed from the schema/types, or should the Gemini prompts be updated to actually use them?** Currently dead enum values create a mismatch between what the type system allows and what the AI can produce.
4. **Is single-tenant WhatsApp (`phoneNumber` globally unique) an accepted permanent constraint, or is multi-tenant/multi-business support on the roadmap?** This is a foundational data-model decision — bolting on tenancy later means migrating `WhatsAppConversation`'s uniqueness constraint and every service function that currently assumes "the one business."
5. **What's the intended production behavior when Gemini is rate-limited or the API key runs out mid-operation?** Fallbacks exist for missing keys, but a Gemini 429/5xx mid-conversation falls through to the same rule-based fallback silently — is that acceptable, or should it alert someone (there's no monitoring/alerting integration for AI failures specifically, distinct from the n8n business-event webhooks)?
6. **Should RAG/SLA analytics move to real tables** instead of regex-parsed `Activity.action` strings? This is currently "good enough" but is a known fragility (item #7 in §6) — worth deciding before more dashboards are built on top of it.
7. **Is the `next.config.ts` build-error suppression (`ignoreBuildErrors`, `ignoreDuringBuilds`) meant to be permanent, or a temporary unblock that needs to be reverted once the underlying TS/lint errors are fixed?** The commit message ("Bypass ESLint/TypeScript build errors ... for Vercel compatibility") suggests it was a deadline-driven workaround, not a deliberate policy — worth confirming and then fixing root causes so the safety net can be turned back on.
8. **Agent assignment / multi-agent support**: there's currently no concept of assigning a ticket to a specific support agent (only the ticket's *creator* `userId`, and a synthetic "System Agent" for WhatsApp). Is per-agent assignment/ownership planned?
