# FlowDesk AI — Multi-Tenancy Design Document

*Design only — no implementation code. Written against the codebase as of the current `main` branch. Every file/line reference below was read directly, not inferred.*

---

## 1. Schema Changes

### New model: `Organization`

```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique   // URL-safe identifier; also the natural key for subdomain routing later
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users              User[]
  tickets            Ticket[]
  activities         Activity[]
  whatsAppConversations WhatsAppConversation[]
  knowledgeDocuments KnowledgeDocument[]
  documentChunks     DocumentChunk[]
}
```

**Do you need more than name/slug/createdAt?** For the core isolation mechanism, no. But two fields are worth adding *now* because retrofitting them later touches every tenant-scoped table again:

- `updatedAt` — essentially free with Prisma's `@updatedAt`, and every other model in this schema already has it (consistency).
- Nothing else. I'm deliberately **not** adding WhatsApp integration fields (phone number ID, access token), billing fields, or feature flags to `Organization` here — those depend on the decision in §5 (WhatsApp routing) and are explicitly out of scope per §8. If §5 lands on "per-org WhatsApp number," that's a separate `OrganizationWhatsAppConfig` model (or fields added to `Organization`) decided at that time, not guessed at here.

### Model-by-model walk of the existing schema (`prisma/schema.prisma`)

| Model | Needs `organizationId`? | Reasoning |
|---|---|---|
| `User` | **Yes** | Every ticket, activity, and document currently traces back to a `User` via `userId`. A user is how a "company's employee" is represented today; scoping starts here. See auth discussion below for the 1-user-1-org vs. many-to-many decision. |
| `Account` | **No** | Auth.js/NextAuth internal OAuth-linkage table (`provider`, `providerAccountId`, tokens). It's already scoped transitively via `userId → User.organizationId`. Adding a redundant `organizationId` here buys nothing and risks drifting out of sync with the user's actual org. |
| `Session` | **No** | Same reasoning as `Account` — pure Auth.js session-token bookkeeping, scoped transitively via `userId`. (Also close to moot: this project uses JWT session strategy per `src/auth.ts:8` — `session: { strategy: "jwt" }` — so the `Session` table is barely used in practice; the adapter still writes to it for `Account`/`User` linkage but session state itself lives in the JWT cookie, not this table.) |
| `VerificationToken` | **No** | Auth.js magic-link/email-verification bookkeeping, not currently used by this app (Google OAuth only, per `src/auth.config.ts`), no `userId` relation even exists on it. Not tenant data. |
| `Ticket` | **Yes** | The core tenant-scoped business object. Currently has no isolation at all beyond `userId` (and `userId`-based filtering is inconsistent — see §3, several ticket queries have zero scoping whatsoever). |
| `Activity` | **Yes** | Queried directly by `userId` in multiple places (`activity.service.ts`, `sla.service.ts`, `rag.service.ts::getRAGAnalytics`) without ever joining through `Ticket`. If `Activity` only had `Ticket.organizationId` to rely on, every one of those direct queries would need an extra join just to filter — denormalizing `organizationId` directly onto `Activity` keeps those queries a single indexed lookup instead of a join, and matches the existing pattern where `Activity` already denormalizes `userId` alongside `ticketId` rather than relying purely on the `Ticket` relation. |
| `WhatsAppConversation` | **Yes** | This is the one with real design weight — `phoneNumber` is currently `@unique` **globally** (`prisma/schema.prisma:165`), meaning two different orgs' customers could never share the same phone-book identity space at all under the current schema, and more importantly, one org's inbound message could theoretically resolve to another org's conversation if you naively add `organizationId` without also fixing the uniqueness constraint. This needs `organizationId` **and** the unique constraint changed from `@unique` on `phoneNumber` alone to `@@unique([organizationId, phoneNumber])`. See §5 for how an inbound message determines *which* org's `phoneNumber` scope to look in — that's the actual hard part, not the schema change itself. |
| `WhatsAppMessage` | **Yes, denormalized** | Every current query goes through `conversationId` (e.g. `whatsapp-actions.ts:33`, `whatsapp.service.ts:83`), so in principle `organizationId` is always reachable via `conversation.organizationId`. I'm still recommending denormalizing it directly onto `WhatsAppMessage` for one concrete reason: it lets you add a straightforward `@@index([organizationId, createdAt])` for any future "all messages across this org" reporting query without a join, at the cost of one extra column and needing to set it consistently at message-creation time (cheap, since the conversation is always in hand at that point — see §3 for exact call sites). Not strictly required if you want to keep the schema smaller; flagging as a judgment call, not a hard requirement like the others. |
| `KnowledgeDocument` | **Yes** | RAG knowledge bases must be per-org — this is explicit in your ask (§4) and currently has zero scoping (`prisma.knowledgeDocument.findMany()` in `src/app/api/knowledge-base/route.ts:17` returns literally every document in the database, full stop). |
| `DocumentChunk` | **Yes, denormalized (not just via `documentId → KnowledgeDocument`)** | This is not a stylistic preference like `WhatsAppMessage` above — it's load-bearing for §4. The vector similarity search in `rag.service.ts::searchSimilarity` is a single raw SQL query directly against `"DocumentChunk"` with no join to `KnowledgeDocument` at all (`src/services/rag.service.ts:60-71`). Requiring a join just to add org filtering would materially change that query's shape and its index usability. Denormalize `organizationId` onto `DocumentChunk` at chunk-creation time (`knowledge.service.ts:116`, already has `documentId` in hand, trivial to also carry `organizationId` through the same call). |
| `ProcessedWebhookEvent` | **No** | This is genuinely cross-org infrastructure, not tenant data. It exists purely to deduplicate Meta's webhook message IDs (`prisma/schema.prisma:218-224`), and Meta's `wamid` message identifiers are unique across Meta's entire system, not scoped to any one WhatsApp Business Account — there's no collision risk across orgs even once multiple orgs each have their own WABA number. Adding `organizationId` here would require knowing which org a message belongs to *before* the dedup check runs, which inverts the dependency (dedup has to happen before routing, not after — see §5). Leave this table exactly as-is. |

**Enums** (`TicketStatus`, `TicketCategory`, `TicketPriority`, `TicketSentiment`, `TicketSource`, `WhatsAppConversationStatus`, `MessageSender`) — no changes needed; enums are type definitions, not tenant-scoped rows.

---

## 2. Auth Implications

### Current setup (read directly from `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`)

- Auth.js v5 (`next-auth@^5.0.0-beta.25`) with `PrismaAdapter(prisma)`, Google OAuth only, `session: { strategy: "jwt" }` (`src/auth.ts:8`).
- `jwt` callback: `if (user) { token.id = user.id; } return token;` (`src/auth.ts:11-16`) — `user` is only populated on the **initial sign-in call**, not on subsequent token refreshes. This is exactly the mechanism you'd reuse for `organizationId`.
- `session` callback: copies `token.id` → `session.user.id` (`src/auth.ts:17-22`).
- `middleware.ts` gates `/dashboard` and `/tickets` on `!!req.auth` only — no org-awareness needed there, it's just "logged in or not."

### Proposed change

1. **`User.organizationId`** (from §1) becomes the source of truth.
2. **`jwt` callback**, extended:
   ```
   async jwt({ token, user }) {
     if (user) {
       token.id = user.id;
       token.organizationId = user.organizationId; // requires the adapter's `user` object to carry it
     }
     return token;
   }
   ```
   The `user` object passed into this callback on sign-in comes from `PrismaAdapter`'s own `getUser`/`createUser`, which returns the full `User` row — so `user.organizationId` is available with **zero extra DB round-trips** beyond what the adapter already does at login. This is the key property you asked for: the *only* DB read involved is the one Auth.js already performs during sign-in; every subsequent request just decodes the JWT cookie.
3. **`session` callback**, extended the same way `id` already is:
   ```
   async session({ session, token }) {
     if (session.user && token.id) {
       session.user.id = token.id as string;
       session.user.organizationId = token.organizationId as string;
     }
     return session;
   }
   ```
4. **Type augmentation**: the codebase currently does `session.user.id = token.id as string` with a bare cast rather than a proper `next-auth.d.ts` module augmentation (I did not find a `next-auth.d.ts` or equivalent `declare module "next-auth"` file anywhere in `src/`). This already means `session.user.id` isn't type-safe today — every call site that reads `session.user.id` is trusting the cast. Adding `organizationId` the same way (another cast) is consistent with existing style, but this is a good moment to add a real module augmentation file (`src/types/next-auth.d.ts` declaring `organizationId: string` on `Session["user"]` and the `JWT` interface) so every one of the ~15 call sites enumerated in §3 that will need `session.user.organizationId` gets compile-time safety instead of another string cast. This is a small, contained addition — not scope creep — because §3 is about to add a new required field to a huge number of call sites, and that's exactly when a typo (`orgnizationId`, wrong casing) becomes expensive to debug.

### Open questions this section deliberately does NOT resolve

- **How does a brand-new user get an `organizationId` at all?** `PrismaAdapter` auto-creates a `User` row on first Google sign-in with no hook for "and also assign them to org X." Two realistic shapes: (a) invite-link signup where the invite token encodes the target org, or (b) a single "default org" for a given deployment (matches your framing of "separate, isolated instances of the same deployment" — each deployment might just have one org and everyone who signs in joins it). This is a real decision but it's a *product* decision (self-serve multi-org SaaS vs. one-org-per-deployment), not something I should silently pick while writing a schema doc. Flagging it here so it doesn't get lost, formally scoping the actual resolution to implementation time.
- **Org membership changes**: because `organizationId` is only read into the JWT at sign-in (matching the existing `token.id` pattern exactly), a user moved to a different org won't see that change until they sign out and back in (or the JWT's `maxAge`/rotation forces a fresh `jwt` callback invocation with `user` populated again, which by default it won't be on mere token refresh). Documented as an accepted trade-off in §8, not solved here.
- **1-user-1-org vs. many-to-many**: I designed `organizationId` directly on `User` (1:1) rather than an `OrganizationMember` join table, because your framing ("separate, isolated instances of the same deployment") reads as one-org-per-user, not a user hopping between multiple companies' data. If that's wrong, this is the single most consequential thing to correct before implementation — it changes the JWT shape, the adapter hook, and every query fix in §3 from "add `organizationId` filter" to "add `organizationId` filter scoped to the user's *currently selected* org, plus an org-switcher UI." Flagging explicitly, not assuming.

---

## 3. Query Scoping Audit

Every Prisma call site touching a now-tenant-scoped model (`User`, `Ticket`, `Activity`, `WhatsAppConversation`, `WhatsAppMessage`, `KnowledgeDocument`, `DocumentChunk`), enumerated file by file. **None of these currently filter by organization** — that's the entire premise of this migration — so the "current state" column is included only to show *what* filtering (if any) exists today (usually `userId`, sometimes nothing at all), and the "fix" column states the concrete change.

### `src/services/ticket.service.ts`

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 24 | `prisma.ticket.create` | none (just sets `userId`) | Add `organizationId: session.user.organizationId` (or a passed-in param) to `data`. |
| 45, 55, 79, 96, 114 | `prisma.activity.create` (5 sites, ticket-creation + webhook-ack activity logs) | none (`userId`/`ticketId` only) | Add `organizationId` to each `data` block. |
| 132 | `prisma.ticket.findMany` (`getTickets`) | `userId` | Add `organizationId` to `where`. |
| 142 | `prisma.ticket.findFirst` (`getTicketById`) | `id`, `userId` | Add `organizationId` to `where`. |
| 159 | `prisma.ticket.findFirst` (`updateTicketStatus`, ownership check) | `id`, `userId` | Add `organizationId` to `where`. |
| 168 | `prisma.ticket.update` (`updateTicketStatus`) | `id` only (no `userId`/org check on the update itself — relies on the `findFirst` above having already validated ownership) | No change needed to the `where` here *if* the preceding `findFirst` (line 159) is correctly org-scoped first — but worth noting this update itself is currently trusting the earlier read rather than re-asserting scope, which is fine as long as both stay in sync. |
| 176, 196 | `prisma.activity.create` (status-change log, resolution-webhook log) | none | Add `organizationId`. |
| 212 | `prisma.whatsAppConversation.findFirst` (`{ where: { ticketId } }`) | `ticketId` only | Add `organizationId` — this is a case where without it, given a ticket ID, you could theoretically look up a conversation row that isn't actually in the same org if `ticketId` alone were ever guessable/leaked, though in practice `ticketId` is a cuid and not enumerable. Still worth the belt-and-suspenders filter for defense in depth. |
| 224 | `prisma.whatsAppConversation.update` | `id` only | Same reasoning as line 168 — relies on line 212's read having validated scope. |
| 253, 259, 267, 276, 286, 289 | `prisma.ticket.groupBy` / `.count` (6 sites in `getTicketStats`) | `userId` | Add `organizationId` to each `where`. |
| 285 | `prisma.whatsAppConversation.count()` (`getTicketStats`) | **none at all — counts every conversation in the entire database** | Add `where: { organizationId }`. This is the most glaring existing gap: the WhatsApp session-count stat on the dashboard is already cross-tenant-broken today, it's just invisible because there's only one tenant. |
| 336 | `prisma.ticket.findMany` (`getQueueTickets`) | `userId`, `status: { not: RESOLVED }` | Add `organizationId` to `where`. |

**Function signatures**: every one of `getTickets`, `getTicketById`, `updateTicketStatus`, `getTicketStats`, `getQueueTickets`, `createTicket` currently takes `userId: string` as an explicit parameter (not pulled from a session internally) — so the fix is mechanical: add an `organizationId: string` parameter alongside `userId` at each call site, threaded through from wherever `session.user.organizationId` is available (Server Actions, API routes — see below).

### `src/services/whatsapp.service.ts`

This file is the trickiest in the whole audit, because — unlike `ticket.service.ts` — none of its functions currently take a `userId`/org parameter at all. It resolves everything purely from `phoneNumber`, and falls back to `prisma.user.findFirst()` to find *any* user to attribute activity to when none is specified.

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 63 | `prisma.whatsAppConversation.findFirst` (`sendWhatsAppMessage`, resolve active session by phone) | `phoneNumber`, `status IN (ACTIVE, ESCALATED)` | Needs `organizationId` added to `where` **and** the function needs an `organizationId` parameter threaded in — this function is currently only ever given a `phoneNumber`, which after §1's schema change is no longer globally unique, so this query is ambiguous without knowing which org's `phoneNumber` namespace to search. This is the concrete point where §5's WhatsApp routing decision becomes a hard dependency of this file, not an optional nice-to-have. |
| 71 | `prisma.whatsAppConversation.create` | n/a | Add `organizationId` to `data`. |
| 83 | `prisma.whatsAppMessage.create` | n/a | Add `organizationId` to `data` (if denormalizing per §1) — trivial here since `finalConvId`'s conversation is already resolved in-scope. |
| 138 | `prisma.whatsAppConversation.findUnique` (`handleIncomingWhatsAppMessage`, `where: { phoneNumber }`) | `phoneNumber` alone — **this is a `findUnique`, which requires the field to actually be unique** | This is the single biggest structural change in the whole audit: once `phoneNumber` uniqueness becomes `@@unique([organizationId, phoneNumber])`, this can no longer be `findUnique({ where: { phoneNumber } })` — it must become `findUnique({ where: { organizationId_phoneNumber: { organizationId, phoneNumber } } })` (Prisma's compound-unique-input naming) or `findFirst({ where: { organizationId, phoneNumber } })`. Function signature needs an `organizationId` param, which — per §5 — has to be resolved from the inbound webhook *before* this line runs. |
| 144 | `prisma.whatsAppConversation.create` | n/a | Add `organizationId`. |
| 156 | `prisma.whatsAppConversation.update` | `id` (already scoped via the row fetched above) | No additional filter needed on the update itself once the read above is correctly scoped; just also set `organizationId` isn't needed here (it's immutable post-creation) — no change beyond making sure line 138 is fixed first. |
| 167 | `prisma.whatsAppMessage.create` | n/a | Add `organizationId` if denormalizing. |
| 201 | `prisma.user.findFirst()` — **"Fetch or create system agent user to track activity timeline"** | **none — grabs literally any user row in the entire database** | This is the second glaring pre-existing bug this audit surfaces. In a single-tenant world "any user" was harmless because there was only ever one tenant's users. Post-multi-tenancy, this would non-deterministically attribute WhatsApp-originated tickets/activities to a **random org's** user — an actual cross-tenant data leak, not just a scoping gap. Fix: this needs to become `prisma.user.findFirst({ where: { organizationId } })`, with a system/service user provisioned **per-org** (either at org-creation time, or lazily here scoped to the resolved org). The "create if none exists" fallback at line 203 also needs `organizationId` set. |
| 203 | `prisma.user.create` (system agent fallback) | n/a | Add `organizationId`. |
| 228 | `prisma.ticket.create` (WhatsApp-originated escalation ticket) | n/a | Add `organizationId`. |
| 247 | `prisma.whatsAppConversation.update` | `id` | No filter change needed (same reasoning as line 156), contingent on upstream scoping being correct. |
| 256, 264, 285, 301, 318 | `prisma.activity.create` (5 sites — escalation logging, webhook-trigger logging) | none | Add `organizationId` to each. |

**Bottom line for this file**: `handleIncomingWhatsAppMessage(phoneNumber, customerName, text)` and `sendWhatsAppMessage(phoneNumber, text, conversationId?, sender?)` both need an `organizationId` parameter added to their signatures, and every caller (the webhook route, the simulator route, `ticket.service.ts::updateTicketStatus`, `whatsapp-actions.ts::sendManualAgentReply`) needs to supply it. For the two functions, that org id has to come from *somewhere other than session* for the real-Meta-webhook path, since incoming WhatsApp messages aren't authenticated user sessions — this is exactly §5's problem.

### `src/services/knowledge.service.ts`

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 85 | `prisma.knowledgeDocument.findUnique` (`processAndIndexDocument`) | `id` only | No change needed to the query itself — `documentId` is already resolved from the org-scoped creation at upload time (see the route below); the document row itself carries `organizationId` once created correctly, so this read doesn't need re-filtering, it needs the **create** call (route-level, not here) to have set it correctly in the first place. |
| 94, 133, 143 | `prisma.knowledgeDocument.update` (status transitions: PROCESSING → INDEXED/FAILED) | `id` only | No filter change needed — same reasoning, these are internal state transitions on an already-resolved row. |
| 116 | `prisma.documentChunk.create` | n/a | Add `organizationId` (denormalized, per §1) — trivial, the enclosing function already has `documentId` and can carry the org id through the same call chain from the upload route. |
| 186 | `prisma.knowledgeDocument.findMany` (`recoverStuckDocuments`, stuck-job sweep) | `status: "PROCESSING"`, `updatedAt: { lt: cutoff }` — **no org filter, scans every org's documents** | **Deliberately do not add one** — see §7, this is a global infrastructure sweep, not a per-org business query. |
| 202 | `prisma.knowledgeDocument.updateMany` (atomic claim, same function) | `id`, `status: "PROCESSING"` | No org filter needed, same reasoning. |
| 223 | `prisma.documentChunk.deleteMany` (cleanup after claiming a stuck doc) | `documentId` | No org filter needed — scoped by `documentId` which is already resolved from the org-agnostic sweep above. |
| 239-242 | `prisma.knowledgeDocument.count()` / `prisma.documentChunk.count()` (×4, `getKnowledgeBaseStats`) | **none at all** | Add `where: { organizationId }` to all four — this function's return value is shown directly on the Knowledge Base dashboard (`src/app/dashboard/knowledge-base/page.tsx`), so today every org would see every other org's document/chunk counts mixed into "their" stats. |

### `src/app/api/knowledge-base/route.ts` (API route, not a service)

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 17 | `prisma.knowledgeDocument.findMany` (`GET`, list documents for the KB dashboard) | **none — `orderBy` only, returns every document in the database** | Add `where: { organizationId: session.user.organizationId }`. This is the third clear pre-existing cross-tenant leak this audit finds: the Knowledge Base UI currently shows literally every uploaded document from every user, with no scoping of any kind beyond requiring *some* authenticated session (line 11-14 only checks `session.user?.id`, never which user). |
| 80 | `prisma.knowledgeDocument.create` (`POST`, upload) | n/a | Add `organizationId: session.user.organizationId` to `data`. |

### `src/app/api/knowledge-base/[id]/route.ts`

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 17 | `prisma.knowledgeDocument.findUnique` (`DELETE`, ownership check before delete) | `id` only | Needs to become `findFirst({ where: { id, organizationId } })` (can't use `findUnique` once you're adding a non-unique-key filter) — otherwise any authenticated user from **any org** can delete any other org's knowledge document just by guessing/observing its id. This is a real authorization hole once multi-tenant, not just a query-hygiene nit. |
| 26 | `prisma.knowledgeDocument.delete` | `id` only | Contingent on the fix above — once line 17 has verified org ownership, this delete is safe to leave keyed on `id` alone. |

### `src/app/api/knowledge-base/search/route.ts`

No direct Prisma calls — delegates to `rag.service.ts::searchSimilarity` (line 19). See §4 for the fix, which lives in `rag.service.ts`, not here. The route itself needs to pass `session.user.organizationId` through to `searchSimilarity`.

### `src/services/rag.service.ts`

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 60-71 | `prisma.$queryRaw` (`searchSimilarity`, the pgvector cosine-similarity search) | **none — searches every `DocumentChunk` row in the database regardless of owner** | See §4 in full detail — this is the RAG scoping question you asked about explicitly. |
| 85 | `prisma.activity.findMany` (`getRAGAnalytics`, `where: { userId, action: { startsWith: "RAG_RETRIEVAL:" } } }`) | `userId` | Add `organizationId` to `where`. Function signature already takes `userId: string`; add `organizationId: string` alongside it. |

### `src/services/sla.service.ts`

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 37 | `prisma.ticket.findMany` (`checkSLABreaches`, the breach-detection sweep) | none — deliberately global today | **Deliberately do not add one** — see §7. |
| 74 | `prisma.ticket.updateMany` (atomic breach claim, same function) | `id`, `slaBreached: false` | No org filter needed — scoped by `id` from the already-resolved sweep above. |
| 90 | `prisma.activity.create` (breach log) | n/a | Add `organizationId` — this one **does** need it despite being inside the "global sweep," because the `Activity` row itself is tenant data that will be read back later by org-scoped queries (e.g. the dashboard's recent-activity feed). The sweep's *query* stays global; the *rows it writes* still need to carry the correct org. |
| 127, 135, 143, 150 | `prisma.ticket.count` (×4, `getSLADashboardStats`) | `userId` | Add `organizationId` to each `where`. |
| 164 | `prisma.ticket.findMany` (`getSLADashboardStats`, response-time calc) | `userId`, `firstResponseMet: true` | Add `organizationId` to `where`. |

### `src/services/activity.service.ts`

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 4 | `prisma.activity.create` (`createActivity`) | n/a | Add `organizationId` parameter, threaded into `data`. (Note: grep found this function is defined but I did not find any caller of `createActivity` elsewhere in the audited call sites above — every actual activity-logging call site inlines `prisma.activity.create` directly rather than using this helper. Worth a note for whoever implements this: either this dead-ish helper should also get the fix for consistency, or it's worth deleting as unused — separate, smaller cleanup, not blocking.) |
| 14 | `prisma.activity.findMany` (`getRecentActivities`, dashboard feed) | `userId` | Add `organizationId` to `where`. |

### `src/app/api/tickets/[id]/route.ts`

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 11 | `prisma.ticket.findUnique` (`GET`, "used by n8n for status checks") | `id` only — **no auth check on this route at all** (confirmed: no `auth()` call anywhere in this file) | This route is intentionally unauthenticated (n8n calls it as a status-check webhook target), so "add `organizationId` from session" doesn't apply the way it does elsewhere — there's no session. If this needs org isolation post-multi-tenancy, it needs a different mechanism entirely (e.g. a signed/scoped token n8n presents, analogous to `CRON_SECRET`), which is a genuinely separate design question from "add a where clause." Flagging as needing its own decision, not silently fixing. |
| 42 | `prisma.ticket.findUnique` (`PATCH`, fetch before SLA-breach update) | `id` only, same no-auth situation | Same flag as above. |
| 52 | `prisma.ticket.update` | `id` only | Same flag. |
| 60 | `prisma.activity.create` | n/a | Would need `organizationId`, but only resolvable once the above is resolved (this route currently has no org context available to it at all). |

### `src/app/api/tickets/sla-check/route.ts` and `src/app/api/knowledge-base/recover-stuck/route.ts`

No direct Prisma calls (delegate to `checkSLABreaches`/`recoverStuckDocuments`). Both are `CRON_SECRET`-protected, not user-session-protected, and — per §7 — deliberately stay global sweeps. No change.

### `src/app/tickets/actions.ts` (Server Actions)

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 29 | `createTicket(session.user.id, validation.data)` | passes `userId` | Add `session.user.organizationId` as an additional argument, per the `ticket.service.ts` signature change above. |
| 51 | `updateTicketStatus(session.user.id, ticketId, status)` | passes `userId` | Same — add `organizationId`. |
| 76 | `triggerEscalationWebhook(payload)` (`testEscalationAction`, dev sandbox) | n/a (no DB call, just an outbound webhook trigger with a synthetic payload) | No schema-level fix needed here, but see §7 — if per-org n8n webhook URLs are introduced, this dev/test action would need to look up which org's webhook URL to test against, probably via `session.user.organizationId`. |

### `src/app/tickets/whatsapp-actions.ts` (Server Actions)

Every function in this file is missing both a session/org check **and** any org filtering — worth calling out as a group, since it's the most consistently unscoped file in the codebase (all functions currently just take a `phoneNumber` and go straight to Prisma with no `auth()` call at all).

| Line | Call | Current filter | Fix |
|---|---|---|---|
| 11 | `prisma.whatsAppConversation.findMany` (`getConversations`) | **none — every conversation in the database, agent-facing inbox list** | Add `auth()` check (currently absent) + `where: { organizationId: session.user.organizationId }`. |
| 33 | `prisma.whatsAppMessage.findMany` (`getConversationMessages`, `where: { conversation: { phoneNumber } }`) | `phoneNumber` via nested relation filter, no org | Once `phoneNumber` isn't globally unique, this needs `where: { conversation: { organizationId, phoneNumber } }` plus the `organizationId` param threaded in from an authenticated caller. |
| 45 | `prisma.whatsAppConversation.findUnique` (`getConversationByPhone`, `where: { phoneNumber }`) | `phoneNumber` alone — same `findUnique`-on-a-no-longer-unique-field problem as `whatsapp.service.ts:138` | Becomes `findFirst({ where: { organizationId, phoneNumber } })` or the compound-unique form. |
| 59 | `prisma.whatsAppConversation.findUnique` (`resetConversation`) | `phoneNumber` alone | Same fix as line 45. |
| 65 | `prisma.whatsAppMessage.deleteMany` | `conversationId` (already scoped via the row resolved above) | No additional filter needed once line 59 is fixed — but this function has **no auth check at all**, meaning today any unauthenticated caller who can invoke this Server Action could wipe any conversation's message history. That's a pre-existing authz gap independent of multi-tenancy, worth fixing regardless (add `auth()` + ownership check). |
| 70 | `prisma.whatsAppConversation.update` | `id` | No filter change needed contingent on the above. |
| 93 | `prisma.whatsAppConversation.findUnique` (`resolveConversationAction`) | `phoneNumber` alone | Same fix as line 45. |
| 98 | `prisma.whatsAppConversation.update` | `id` | No change needed contingent on above. |
| 104 | `prisma.ticket.update` (mark linked ticket RESOLVED) | `id` only | No org filter needed if `conv.ticketId` was resolved from an already-org-scoped conversation. |
| 127 | `prisma.whatsAppConversation.findUnique` (`sendManualAgentReply`) | `phoneNumber` alone | Same fix as line 45. |

### `src/lib/test-integration.ts` and `scripts/test-*.ts`

Not part of the running application — manual dev/test scripts (`test-integration.ts`, `test-sla-rag-flow.ts`, `test-whatsapp-flow.ts`). They call `prisma.user.findFirst()` and `createTicket(user.id, ...)` directly with no org concept at all today. These will simply break (or silently operate against whichever org their arbitrary "first user" belongs to) once `organizationId` becomes required — they'll need updating alongside the real code, but they're test scaffolding, not a scoping *risk* the way the app routes are. Lower priority, same mechanical fix pattern (resolve/create a test org, thread its id through).

---

## 4. RAG / Knowledge Base Scoping

The query in question, exactly as it exists today (`src/services/rag.service.ts:60-71`):

```sql
SELECT id, "documentId", "chunkIndex", content, 1 - (embedding <=> $1::vector) AS similarity
FROM "DocumentChunk"
WHERE embedding IS NOT NULL AND 1 - (embedding <=> $1::vector) >= $2
ORDER BY embedding <=> $1::vector ASC
LIMIT $3
```

**The fix, given `organizationId` denormalized onto `DocumentChunk` per §1:**

```sql
SELECT id, "documentId", "chunkIndex", content, 1 - (embedding <=> $1::vector) AS similarity
FROM "DocumentChunk"
WHERE "organizationId" = $2 AND embedding IS NOT NULL AND 1 - (embedding <=> $1::vector) >= $3
ORDER BY embedding <=> $1::vector ASC
LIMIT $4
```

Using Prisma's tagged-template `$queryRaw` (already the pattern in use as of the recent raw-SQL-safety cleanup), this is a one-line addition to the `WHERE` clause, parameterized the same way `threshold`/`limit` already are — nothing structurally new.

### Does the vector index need to change?

Here's the part worth being precise about: **there currently is no vector index at all.** I checked `prisma/schema.prisma` — the `DocumentChunk.embedding` column is declared as `Unsupported("vector(3072)")` (line 206) with only a plain `@@index([documentId])` (line 210) on the table; there is no `ivfflat` or `hnsw` index on `embedding` anywhere in the schema or in any migration I found. That means `searchSimilarity` today is already doing a **brute-force sequential scan** — computing the cosine distance (`<=>`) against every single row in `DocumentChunk` and sorting the results, with no approximate-nearest-neighbor acceleration whatsoever.

This actually makes the multi-tenancy change to this specific query *simpler*, not harder, in one sense: adding `WHERE "organizationId" = $2` to a sequential scan is just a cheap equality filter Postgres applies while it's already scanning every row — it doesn't interact with or break an ANN index, because there isn't one to break. Practically, filtering to one org's chunks first will usually make the query **faster** than today (fewer rows to compute cosine distance against), not slower.

What I'd actually recommend, in order:

1. **Now (part of this migration)**: add a plain B-tree index — `@@index([organizationId])` on `DocumentChunk` (or a composite `@@index([organizationId, documentId])` if you also want to accelerate "all chunks for this doc, within this org" lookups, though `documentId` alone is already sufficiently selective that this is a minor optimization). This is cheap, standard, and directly helps the equality-filter portion of every query in this file.
2. **Separately, not part of this task**: at some point this project should add a real `ivfflat` or `hnsw` index on `embedding` — that's pre-existing tech debt independent of multi-tenancy (the current brute-force scan will get slow long before multi-tenancy is the reason why, once the knowledge base has thousands of chunks for even one org). Worth flagging here because it interacts with this decision: **when** that index does get added, pgvector's `ivfflat`/`hnsw` indexes don't support arbitrary composite filtering the way a B-tree does — combining a vector ANN search with an equality filter on `organizationId` generally works via one of two strategies (Postgres's planner choosing to filter first if `organizationId` is selective enough, or filtering after an approximate top-K scan, which can reduce recall if a single org's chunks are a small fraction of the total table). This isn't a blocker for the multi-tenancy migration — it's a note for whoever eventually adds that index to test recall/performance with the org filter in place, not to add it blind against a single-tenant assumption.

**Net answer to your question**: org-scoping this query is a one-line `WHERE` addition with no breaking index interaction, *because there's no ANN index yet to interact with*. Add a plain B-tree index on `organizationId` now; treat "add a real vector index" as separate pre-existing tech debt to revisit later, with a note about filter/recall interaction when that day comes.

---

## 5. WhatsApp Routing — Options, Not a Decision

Today, `handleIncomingWhatsAppMessage` (`whatsapp.service.ts:130`) resolves everything from `phoneNumber` alone, with no concept of "which org." Once `WhatsAppConversation.phoneNumber` uniqueness becomes per-org (§1), something upstream has to answer "which org does this inbound message belong to" *before* any conversation lookup happens. Concretely, this has to be resolved inside `src/app/api/webhooks/whatsapp/route.ts::POST`, before line 173's call into `handleIncomingWhatsAppMessage`.

One grounded technical fact that shapes all three options: Meta's real webhook payload (parsed at `route.ts:135-147`) includes a `value` object that — per Meta's documented webhook shape — also carries a `metadata.phone_number_id` field identifying **which of your WhatsApp Business phone numbers the message was sent to**. The current parsing code doesn't read this field at all (it only pulls `message.from`, `contact.profile.name`, `message.text.body`, `message.id`), but the field is already present in every real Meta payload today — it's not something that needs to be requested or enabled, just read.

### Option A — Per-org dedicated WhatsApp Business phone number

Each org provisions (or is assigned) its own WABA phone number via Meta. Store a mapping — either directly on `Organization` (`whatsappPhoneNumberId String? @unique`) or a small separate `WhatsAppNumberMapping { phoneNumberId String @unique, organizationId String }` table if you want to allow one org to own multiple numbers later. On inbound webhook, read `value.metadata.phone_number_id` and look up the owning org **before** touching `WhatsAppConversation` at all.

- **Pros**: Clean, unambiguous isolation — there's no routing logic beyond a lookup, no customer-facing friction, matches how Meta's own multi-number WABA system is actually designed to be used. Also cleanly extends the existing per-org-webhook-URL idea from §7 (n8n) — "org owns its own external-facing identifiers" becomes a consistent pattern.
- **Cons**: Every org needs their own Meta Business verification and a provisioned phone number before they can use WhatsApp support at all — real onboarding friction and (depending on Meta's current terms) potential per-number cost. Doesn't help a "try it out with zero setup" trial flow.

### Option B — Shared number, customer-provided routing signal

One WhatsApp number for the whole deployment; the customer's *first* message must include something that identifies the org — a keyword, a short code, or a link that pre-fills a specific opening message (Meta supports "click-to-WhatsApp" links with a pre-filled `text` parameter, which could encode an org slug). Subsequent messages in the same conversation are then already resolved via the existing `WhatsAppConversation` row (which now remembers its org).

- **Pros**: Zero per-org Meta provisioning — every org can be live instantly on a shared number. Cheaper to operate at small scale.
- **Cons**: Real UX cost — a customer who just texts "hi" to the shared number with no code has no way to be routed correctly, and expecting end customers to know/type a code before every new conversation is a rough first-contact experience for a support channel specifically. Also fragile: if the customer's very first message doesn't parse as a valid routing code, you're stuck with an ambiguous inbound message and no good fallback.

### Option C — Explicit phone-number-to-org mapping table (implementation refinement of A)

Functionally the same as Option A's core idea (route by `phone_number_id`), but modeled as its own `WhatsAppNumberMapping` table from the start rather than a field on `Organization`, specifically so **one org can register multiple numbers** (e.g., a sales line and a support line both routing to the same org, or a company migrating numbers over time without losing history). This is really "Option A, but don't paint yourself into a 1-number-per-org corner."

- **Pros**: Same isolation guarantees as A, more flexible for orgs with multiple numbers or evolving Meta configurations, and the extra table is cheap.
- **Cons**: Same onboarding friction as A (still requires each org to have at least one real provisioned number) — this option only changes the *data model*, not the underlying operational requirement.

**My honest read, without picking for you**: A/C are the same underlying approach and both correctly model how WhatsApp Business actually works today; the only question between them is whether you expect any single org to ever need more than one number (if genuinely never, A's simplicity wins; if plausibly yes, C avoids a later migration). B is real and used by some multi-tenant WhatsApp platforms, but it trades a one-time provisioning cost (A/C) for an ongoing, per-conversation UX cost (B) — worth picking A/C unless per-org Meta provisioning is a hard blocker for your onboarding model.

---

## 6. Migration Strategy for Existing Data

Given this is dev/demo data (not live production traffic), the actual operational risk here is low, but the *pattern* below is the same one you'd want even if it weren't — worth doing properly since it's cheap to do so.

1. **Add `organizationId` columns as nullable first.** `prisma db push` (or a proper migration once this project adopts `prisma migrate`) adding `organizationId String?` to every tenant-scoped model from §1, plus the new `Organization` table itself. Nullable-first means this step is non-breaking — existing rows just get `NULL`, nothing rejects.
2. **Create a default org.** Insert one `Organization` row — `name: "Demo Org"`, `slug: "demo"` (or whatever's meaningful) — either via a one-off script or a Prisma seed.
3. **Backfill.** For each tenant-scoped table, `UPDATE "TableName" SET "organizationId" = '<demo-org-id>' WHERE "organizationId" IS NULL`. Order doesn't matter much here since none of these tables have a foreign-key relationship *to each other* through `organizationId` (they each independently point at `Organization`), but do `User` first since §2's auth flow depends on every existing user having an org before anyone can log in post-migration and get a working JWT.
4. **Fix `WhatsAppConversation`'s uniqueness constraint** in the same migration step: drop the existing `@unique` on `phoneNumber` alone, add `@@unique([organizationId, phoneNumber])`. Since every row will already have the same `organizationId` (the demo org) after step 3, this is safe — you're not at risk of a uniqueness collision during the migration, because there's still only one org's worth of `phoneNumber` values in play until a second org is ever created.
5. **Make `organizationId` required.** Once step 3 has confirmed zero remaining `NULL` values (a simple `SELECT COUNT(*) WHERE "organizationId" IS NULL` per table, should be zero across all of them), alter each column to `organizationId String` (drop the `?`) and add the appropriate `@relation` + `onDelete` behavior (`Restrict` or `Cascade` depending on whether you want deleting an org to cascade-delete all its data — recommend `Restrict` by default, force an explicit "delete this org and everything in it" admin action rather than an accidental cascade).
6. **Run the full test suite / manual integration scripts** (`scripts/test-sla-rag-flow.ts`, `scripts/test-whatsapp-flow.ts`) against the migrated dev DB before considering this done — they'll need their own small updates (per §3's note on test scripts) to pass an `organizationId`, but running them is the actual verification that nothing's silently broken.

No data loss at any point in this sequence — steps 1-3 are purely additive, step 4 only tightens a constraint after the data already satisfies it, step 5 only tightens nullability after verifying it's already satisfied.

---

## 7. n8n and SLA Cron Implications

**Short answer: the sweep queries stay global; the webhook *dispatch* step becomes org-aware. These are different pieces of the same functions, and they don't need the same treatment.**

Walking through why, using both sweeps:

- **`checkSLABreaches`** (`sla.service.ts:33`) and **`recoverStuckDocuments`** (`knowledge.service.ts:183`) are both, structurally, "find every row across the whole database matching condition X, and atomically claim + act on each one." The *condition* they're checking (a ticket's `firstResponseDueAt`/`resolutionDueAt` has passed; a document has sat in `PROCESSING` too long) is **intrinsic to that individual row** — it doesn't depend on which org owns it. A ticket 20 minutes past its response SLA is breached regardless of org. There is no correctness reason to run this sweep once per org instead of once globally; running it globally is strictly more efficient (one query scanning all orgs' overdue tickets beats N separate per-org cron invocations doing the same work N times over, especially against a serverless function budget that's already a known constraint in this codebase per the existing `STUCK_PROCESSING_THRESHOLD_MS` comment about Vercel's execution ceiling).
- **What *does* need to become org-aware**: the notification step at the end of each loop iteration. `triggerSlaBreachWebhook` (called from `sla.service.ts:101`) and the equivalent `triggerNewTicketWebhook`/`triggerEscalationWebhook`/etc. calls throughout `ticket.service.ts` and `whatsapp.service.ts` all currently resolve their target URL from a single set of global `N8N_WEBHOOK_*` env vars (`n8n.service.ts:119-150`, e.g. `process.env.N8N_WEBHOOK_SLA_BREACH`). Once there's more than one org, this is wrong by construction — org B's SLA breach shouldn't fire a webhook at org A's n8n instance (or, in the current single-shared-deployment reality, firing all orgs' events at the *same* webhook URL means every org's on-call alerts land in the same n8n workflow with no way to route them to the right team). This needs the webhook-URL lookup to move from `process.env.N8N_WEBHOOK_*` to a per-org settings source (a `webhookUrl` field per event-type on `Organization`, or a small `OrganizationIntegration` table) — a data-modeling change to `n8n.service.ts`'s `triggerWebhook` callers, not to the sweep queries themselves.
- **The `CRON_SECRET` auth model doesn't need to change.** Both sweep endpoints (`/api/tickets/sla-check`, `/api/knowledge-base/recover-stuck`) are called by a single GitHub Actions workflow on a fixed schedule, authenticated by one shared secret — that's a deployment-level operation ("run the global sweep"), not a per-org action, so there's no reason to introduce per-org cron secrets or per-org scheduled workflows. One sweep, one secret, still correct post-multi-tenancy.

---

## 8. Explicitly Out of Scope

Calling these out so they don't get pulled in by accident while implementing §1-§7:

- **Per-org billing/plans/usage metering** — no `Plan`/`Subscription` model, no Stripe integration, no usage-based limits (e.g. capping tickets or documents per org). Pure data isolation only.
- **Custom domains or subdomain-based org routing** — the `Organization.slug` field exists (§1) because it's a natural key worth having, but no middleware/DNS/subdomain-resolution logic is proposed here. Org resolution in this design is entirely session-based (§2), not URL-based.
- **Org-level feature flags** — no per-org toggles for enabling/disabling features (e.g. "org X doesn't get WhatsApp"). Every org gets the same feature set.
- **Org branding / white-labeling** — no per-org logo, color theme, or custom email/WhatsApp sender identity beyond what §5 already requires (a phone number).
- **Role-based access control within an org** — this design has exactly one flat `User` role per org (implicitly "member"). No admin/agent/viewer distinction, no per-user permissions. Every user in an org can see and act on all of that org's tickets, same as today's single-tenant behavior.
- ~~**Self-serve org creation / signup flow**~~ — **resolved in §9**, added below: invite-link-based multi-org signup.
- **Cross-org superadmin tooling** — no "platform admin who can see all orgs" role or UI. If that's ever needed (e.g. for your own support/debugging), it's a deliberately separate, higher-trust surface, not a byproduct of this design.
- **JWT invalidation on org membership change** — flagged as an accepted trade-off in §2 (users re-authenticate to pick up org changes), not solved with token revocation lists or short-lived tokens.
- **Org deletion / data export (GDPR-style offboarding)** — §6 recommends `onDelete: Restrict` specifically so an accidental cascade-delete can't happen, but a deliberate "delete this org and all its data" admin flow, or a data-export flow, isn't designed here.
- **Data residency / regional pinning** — single Neon Postgres instance for all orgs, no per-region database routing.
- **Per-org rate limiting** — no protection against one org's usage (e.g. document uploads, WhatsApp volume) degrading service for others sharing the same deployment/database.
- **A real vector ANN index** (`ivfflat`/`hnsw`) — noted in §4 as pre-existing tech debt independent of multi-tenancy; not part of this migration.

---

## 9. Org Creation & Invite Flow

This section resolves the "self-serve org creation / signup flow" question §2 and §8 originally left open. Decision made: **invite-link-based multi-org signup** — a new user's signup link encodes which org they're joining, not a single default org for the whole deployment. This extends §1 (schema) and §2 (auth) directly; nothing here contradicts or replaces those sections.

### 9.1 How does an org get created in the first place?

Walking through the realistic flow, there are two distinct entry points that need to stay distinct: **joining an existing org via invite** (the common case, most users) and **creating a brand-new org** (rare — happens once per company that adopts FlowDesk AI).

The awkward part is the second case. §9.3 below establishes that sign-in will be **denied by default** for any Google account with no existing `User` row and no matching pending `Invite` (this is §9.4's rule, needed for security). That's exactly right for "random person tries to sign in" — but it means a genuinely first-time company can't just click "Sign in with Google" and land somewhere; there's nothing yet for their email to match against.

**Recommended flow**: model org creation as *self-invitation*, so it reuses the exact same invite-consumption mechanism (§9.3) instead of needing a separate code path:

1. A prospective new company visits a distinct, pre-auth entry point — e.g. `/signup/create-organization` (deliberately **not** the same button as `/login`, since `/login` is for people who already have an account or a pending invite).
2. They fill in an org name (and a derived `slug`) and **the email they intend to sign in with**. This form does not touch Google OAuth yet.
3. On submit, the server (a) creates the `Organization` row, then (b) creates an `Invite` row targeting the email they just typed, with `organizationId` set to the org just created, generated exactly the same way any other invite is (§9.2) — this person is, mechanically, inviting themselves to the org they just asked to create.
4. They're redirected into the normal Google sign-in flow. §9.3/§9.4's gate now succeeds for them, for the same reason it would succeed for anyone accepting a real teammate invite: a valid, unexpired, unconsumed `Invite` exists for the email Google asserts.
5. Their `User` row gets `organizationId` set via the exact same mechanism as any invited teammate (§9.3) — **no special-casing is needed anywhere in the auth callbacks.** "Create an org" and "accept an invite" are the same code path from the auth layer's point of view; only the pre-auth form differs.

**Why this is safe even though the form asks for an email before any verification**: the email typed into the create-org form is *not* trusted on its own — it only ever grants access to whatever Google account subsequently proves ownership of that exact email via OAuth. If someone typed `someone-elses-address@company.com` into the form hoping to grant themselves access, they'd still have to actually complete Google's OAuth consent screen as that email to ever benefit — which they can't do without controlling that Google account. The self-invite is inert until Google-verified sign-in consumes it.

**What this deliberately does not solve**: who inside an *existing* org is allowed to send new teammate invites (§9.5 covers the "invite teammate" UI action, but not who's authorized to trigger it). §8 already excludes role-based access control from this whole design — there's no "owner"/"admin"/"member" distinction anywhere in the current plan, every user in an org has identical permissions. The simplest option consistent with that existing decision is: **any existing member of an org can invite another member** — matches the flat, no-RBAC model already decided. If that's too permissive for your actual use case, introducing an "only the org creator can invite" restriction means reopening §8's RBAC exclusion, which is a bigger decision than this section should make unilaterally. Flagging it, not deciding it.

### 9.2 The `Invite` model

```prisma
model Invite {
  id             String    @id @default(cuid())
  email          String
  organizationId String
  token          String    @unique
  invitedById    String
  expiresAt      DateTime
  acceptedAt     DateTime?
  createdAt      DateTime  @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedBy      User         @relation(fields: [invitedById], references: [id], onDelete: Cascade)

  @@index([email])
  @@index([token])
  @@unique([organizationId, email])
}
```

- **`token` generation**: `crypto.randomBytes(32).toString("base64url")` — Node's built-in `crypto` module, which this codebase already imports elsewhere (`src/app/api/webhooks/whatsapp/route.ts` uses it for HMAC signature verification), so this introduces no new dependency. 32 bytes is 256 bits of entropy — not brute-forceable, and `base64url` avoids URL-encoding issues (no `+`/`/`/`=`). The token is stored in plaintext in this design (not hashed) because it's short-lived and single-use, a materially different risk profile from a long-lived credential like a password; hashing it at rest (bcrypt/sha256, compare on lookup) is a reasonable defense-in-depth addition if you want it, but not required for the mechanism to be sound.
- **Single-use vs. multi-use — recommendation: single-use, tied to one specific email.** An `Invite` targets exactly one email address and is consumed (⇒ `acceptedAt` set) the moment that person completes sign-in. This is the safer and simpler default: a leaked invite link can't be used to add unlimited unknown people to your org, and it matches your framing ("a new user gets a link that encodes which org they're joining" — singular). The alternative — a generic, multi-use "org invite link" anyone can use to join (Slack-workspace-style) — is a real, valid pattern elsewhere, but it's a different trust model (implicit "anyone with the link is trusted") that I'm not recommending here since it wasn't what you described; noting it only so it's a conscious non-choice, not an oversight.
- **`@@unique([organizationId, email])`**: prevents accumulating duplicate pending invites for the same person in the same org (re-sending an invite should update/replace the existing row's `token`/`expiresAt` rather than create a second one). Does **not** prevent inviting the same email to *multiple different* orgs — that's a real edge case (someone consults for two companies both on FlowDesk AI) this design doesn't need to solve given §2's existing one-org-per-user decision; if they accept a second org's invite, `events`/`jwt`-time logic in §9.3 would overwrite their `organizationId` to the new org, which is a reasonable-if-unglamorous behavior worth being aware of rather than solving further here.
- **Expiry — recommend 7 days.** Long enough that a real invite doesn't expire before the recipient gets around to checking their email, short enough to bound how long a leaked/intercepted link stays exploitable. `expiresAt: DateTime` checked at both read points (§9.1 step 4's landing page, and §9.3's actual auth-time gate) — the acceptance page validates it for a friendly error message; the auth-time check is the one that actually matters for security, since the acceptance page's validation is not itself a trust boundary.

### 9.3 Connecting an invite to Google OAuth sign-in — the actual mechanism

This is the part I investigated directly against the installed `@auth/prisma-adapter@2.11.2` and `@auth/core` (bundled with `next-auth@5.0.0-beta.25`) source rather than assuming.

**The premise doesn't hold as originally stated, and here's the exact evidence.** `PrismaAdapter`'s `getUserByAccount` (`node_modules/@auth/prisma-adapter/index.js:8-14`) looks up a returning user by the `Account` table's `provider_providerAccountId` compound key — **not by email at all**. Email-based matching is a separate, distinct decision made one layer up, inside Auth.js core's `handleLoginOrRegister` (`node_modules/@auth/core/lib/actions/callback/handle-login.js`). Tracing the actual OAuth branch (lines 174-274) for the case that matters here — a Google sign-in with no existing linked `Account` row:

```js
// line 231-234, inside the OAuth branch, when no Account match was found:
const userByEmail = profile.email ? await getUserByEmail(profile.email) : null;
if (userByEmail) {
    const provider = options.provider;
    if (provider?.allowDangerousEmailAccountLinking) {
        // opt-in only — links to the existing row
        user = userByEmail;
        isNewUser = false;
    } else {
        // DEFAULT behavior: refuses to link, throws instead
        throw new OAuthAccountNotLinked(
          "Another account already exists with the same e-mail address",
          { provider: account.provider }
        );
    }
}
```

So: **pre-creating a `User` row with `email` + `organizationId` set, and hoping Auth.js quietly links the subsequent Google sign-in to it, does not work by default.** It only works if `allowDangerousEmailAccountLinking: true` is set on the Google provider config (`src/auth.config.ts`) — and Auth.js's own maintainers named that flag "dangerous" deliberately, per the comment directly above it in the source (lines 218-230): it exists to protect against a case where an *unverified* email from some OAuth provider could be used to hijack an existing account. Google specifically does verify email ownership before allowing OAuth, so enabling this flag for Google-only auth (as this app already is, per `src/auth.config.ts`) is a commonly-accepted trade-off — but it's real: enabling it means *any* Google sign-in matching *any* existing `User.email`, invited or not, silently attaches to that row, with no additional confirmation step. That's a wider blast radius than "just make invites work."

**The alternative I'm recommending instead — and it needs no dangerous flag at all:**

Don't pre-create the `User` row. Only create the `Invite` row (§9.2) at invite-send time. When the invited person clicks their link and signs in with Google for the first time, there genuinely is **no existing `User` row with their email** — so Auth.js takes its completely normal, already-in-use, non-dangerous "create a new user" path (`handle-login.js:253-262`, the same path every first-time sign-in in this app already takes today). No email collision, no linking decision, no flag needed.

Org assignment then happens as a small extension to the `jwt` callback **that §2 of this document already proposes modifying** — not a new hook:

```ts
async jwt({ token, user }) {
  if (user) {
    token.id = user.id;
    if (user.organizationId) {
      token.organizationId = user.organizationId;
    } else {
      // Brand-new user with no org yet — can only reach this state via §9.4's
      // signIn gate, which already confirmed a valid Invite exists for this email.
      const invite = await prisma.invite.findFirst({
        where: { email: user.email, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (invite) {
        await prisma.user.update({
          where: { id: user.id },
          data: { organizationId: invite.organizationId },
        });
        await prisma.invite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
        token.organizationId = invite.organizationId;
      }
    }
  }
  return token;
}
```

This reuses the exact callback §2 already modifies, rather than introducing a second lifecycle hook (`events.createUser` would also work mechanically — Auth.js fires it right after `createUser` succeeds, per `handle-login.js:260-263` — but doing it here keeps "how does `token.organizationId` get established" in one place instead of two). The `if (user)` guard already means this only runs at actual sign-in time, never on token refresh, exactly as §2 documents for the existing `token.id` assignment — no new DB-round-trip concern beyond what §2 already accepted.

### 9.4 Rejecting sign-in with no invite and no existing account

Confirmed: yes, reject at sign-in, and it lives in the `signIn` callback specifically — **not** the `jwt` callback above, because by the time `jwt` fires with a populated `user`, the adapter has already created the `User` row (per §9.3's traced source, `createUser` runs before the token/session step). `signIn` is Auth.js's dedicated gate for *preventing* that creation from happening at all — returning `false` (or throwing) stops the flow before any DB write.

```ts
async signIn({ user, profile }) {
  const email = profile?.email ?? user?.email;
  if (!email) return false;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return true; // returning user, always allowed back in

  const validInvite = await prisma.invite.findFirst({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  return !!validInvite; // false → Auth.js surfaces a sign-in error, no User row is created
}
```

Two DB reads (`User` by email, `Invite` by email) added to the sign-in path — both are simple indexed lookups (`User.email` is already `@unique`; `Invite.email` gets `@index([email])` per §9.2), not the kind of cost that matters relative to the OAuth round-trip itself already happening. When this returns `false`, Auth.js redirects back to the sign-in page with an error state rather than silently failing — see §9.5 for where that needs to surface.

### 9.5 UI surfaces needed (enumeration only, not designed here)

1. **"Create your organization" pre-auth form** — org name + slug + the email they'll sign in with (§9.1). Not the same page/button as `/login`.
2. **"Invite teammate" action**, somewhere inside the authenticated app (a settings/team page doesn't exist yet in this app — would be new). Takes an email, creates/refreshes an `Invite` row, needs a delivery mechanism for the actual link — worth noting this is a natural fit for the existing n8n webhook pattern already used for every other outbound notification in this codebase (`n8n.service.ts`), rather than inventing a new email-sending path from scratch.
3. **Accept-invite landing page**, e.g. `/invite/[token]` — the link a teammate actually clicks. Looks up the `Invite` by `token` (not by email — the token is what's in the URL), validates it's unexpired/unconsumed, shows "You've been invited to join {org name}" with a "Sign in with Google" button. This is a UX/early-error-message checkpoint, not the security boundary — §9.4's `signIn` callback independently re-validates by email regardless of what this page showed, so this page can't be tricked into granting access on its own.
4. **Sign-in error surface** for §9.4's rejection case — Auth.js v5 supports a custom error page via `pages.error` in `auth.config.ts` (currently only `pages.signIn` is set); simplest option is pointing `error` at the same `/login` route and reading the error query param there, showing something like "This Google account isn't associated with any FlowDesk organization. Ask your team admin for an invite link."
5. *(Optional, not required for the mechanism to function)* a pending-invites list on the team/settings page, so whoever sends invites can see what's outstanding, expired, or accepted.

### 9.6 Minimal role distinction: OWNER vs MEMBER (gating invites only)

§9.1 flagged and deliberately did not resolve "who inside an existing org is allowed to send new teammate invites," noting that resolving it meant reopening §8's RBAC exclusion. Decision made: add the smallest possible role distinction needed to answer that one question — not a permissions system.

**A consistency correction this surfaces, before the role itself**: §6 step 5 currently says to make `organizationId` `NOT NULL` on every tenant-scoped table, `User` included, once backfill is confirmed complete. That's correct for `Ticket`, `Activity`, `KnowledgeDocument`, etc. — app code always has `organizationId` in hand when creating those rows. It's **not** correct for `User`. Per §9.3's traced adapter source, `PrismaAdapter.createUser` (`node_modules/@auth/prisma-adapter/index.js:5`) calls `p.user.create(stripUndefined(data))` with only whatever Auth.js's OAuth `profile` handling passes it — `email`, `name`, `image`, `emailVerified`. It has no concept of `organizationId` at all; that field only gets attached a moment later, in the `jwt` callback's follow-up `prisma.user.update` (§9.3). If `User.organizationId` were `NOT NULL`, that initial `createUser` INSERT would fail its constraint for every single invited signup, before the `jwt` callback ever runs — the invite flow as designed would not work at all. **Correction to §6: `User.organizationId` stays nullable (`String?`) permanently, not just during the backfill migration window.** Every other table keeps §6's original "make it required" treatment unchanged — this correction is scoped to `User` specifically, for the specific reason above.

**Schema change** — same nullability reasoning applies identically to `role`, since it's assigned at the exact same moment as `organizationId` (§9.3's `jwt` callback), not at `createUser` time:

```prisma
enum OrganizationRole {
  OWNER
  MEMBER
}

model User {
  // ...existing fields unchanged...
  organizationId String?           // stays nullable — see correction above
  role           OrganizationRole? // null until an Invite is consumed; set alongside organizationId
  organization   Organization?     @relation(fields: [organizationId], references: [id])
}
```

`Invite` (§9.2) gains one field, defaulting to the common case:

```prisma
model Invite {
  // ...existing fields unchanged...
  role OrganizationRole @default(MEMBER)
}
```

**Where OWNER gets set — walking through §9.1 and §9.3 with this added.** §9.1 step 3 already has the self-invitation moment: creating an org creates an `Invite` targeting the creator's own email. That invite is now created with `role: OWNER` explicitly (every other invite — the "invite teammate" flow in §9.5 — is created with the schema default, `MEMBER`, untouched). No other step in §9.1 changes.

The actual write happens where §9.3 already writes `organizationId` — the `jwt` callback's invite-consumption branch — now also carrying `role` through:

```ts
if (invite) {
  await prisma.user.update({
    where: { id: user.id },
    data: { organizationId: invite.organizationId, role: invite.role }, // role added
  });
  await prisma.invite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });
  token.organizationId = invite.organizationId;
  token.role = invite.role; // added
}
```

Worth doing as a small hardening note while touching this code again: wrap the two `update` calls above in `prisma.$transaction([...])` so `organizationId`/`role` assignment and invite consumption succeed or fail together — not strictly required for correctness (a failure between the two would just leave an unconsumed invite the user could retry), but cheap to do right.

This also means §2's `session`/`jwt` callback change needs the same one-line extension already used for `organizationId` — `session.user.role = token.role as OrganizationRole` alongside `session.user.organizationId = token.organizationId as string` — and the type-augmentation file §2 proposed adding needs `role` on `Session["user"]`/`JWT` too. Not a new mechanism, the same one, one more field riding along.

**Where the OWNER-only check lives for sending an invite.** §9.5 item 2 enumerated "an 'invite teammate' action" without specifying it; specifying it now: a new Server Action, `src/app/settings/team-actions.ts` (new file — no `settings` route exists yet in this app, consistent with §9.5 already noting a team/settings page would be new), following the exact `auth()`-then-check shape every existing Server Action in this codebase already uses (`src/app/tickets/actions.ts`'s `createTicketAction`/`updateTicketStatusAction` are the direct pattern to match):

```ts
"use server";

export async function sendInviteAction(email: string) {
  const session = await auth();
  if (!session || !session.user?.id || !session.user?.organizationId) {
    return { error: "Unauthorized" };
  }
  if (session.user.role !== "OWNER") {
    return { error: "Only organization owners can invite teammates." };
  }

  // ...create/refresh the Invite row (§9.2), targeting `email`,
  //    organizationId: session.user.organizationId, role: "MEMBER" (default)...
}
```

`session.user.role` is read straight off the session object established above — no extra DB round-trip, exactly the property that made `organizationId` cheap to check in §2, now extended to `role`. The check is a hard gate before any `Invite` row is created or touched, not a UI-only restriction (a non-OWNER hitting this Server Action directly, bypassing whatever UI button gates it, gets rejected identically).

**What explicitly does NOT change.** This is the whole point of keeping this minimal, stated plainly so it doesn't drift during implementation: **`role` is read in exactly one place — `sendInviteAction`'s authorization check above.** Nowhere else. OWNER and MEMBER see the same tickets, the same WhatsApp conversations, the same knowledge base documents, the same dashboard stats — every single query fix enumerated in §3 remains scoped by `organizationId` alone, with no additional `role` filtering added anywhere. There is no OWNER-only ticket view, no MEMBER-restricted knowledge-base upload, no role check anywhere in `ticket.service.ts`, `whatsapp.service.ts`, `knowledge.service.ts`, or any API route/Server Action audited in §3. If a future need arises to gate some other action by role, that is a new, separate decision to make explicitly — not an extension of this one by inference.

**Edge case: the sole OWNER leaves.** Deciding this, not leaving it open: **no promote/transfer-ownership mechanism is being designed right now**, and here's why that's a reasonable call rather than an oversight — nowhere in this document (§1 through §9) is a "remove member from org" action ever proposed. The scenario "the only OWNER is gone and no one can promote a replacement" has no trigger path through anything this design actually builds; it could only happen via direct database manipulation outside the app, which is already a break-glass scenario with its own tooling (fix it with a manual `UPDATE` in that case). Building a promotion/transfer UI now, for a scenario the app itself can't cause, is exactly the over-design this task asked me to avoid. The decision that **does** need to be written down now, so it isn't silently lost: **whenever a "remove/deactivate member" feature is eventually designed, it must refuse to remove or demote an org's last remaining OWNER.** That invariant — every `Organization` with at least one member always has at least one OWNER — is the actual guardrail; it costs nothing to state now and prevents the dead-end scenario from ever becoming reachable once member removal *is* built.

---

## Summary Checklist (for implementation planning, not for now)

- [ ] Add `Organization` model + `organizationId` to `User`, `Ticket`, `Activity`, `WhatsAppConversation`, `WhatsAppMessage`, `KnowledgeDocument`, `DocumentChunk`.
- [ ] Fix `WhatsAppConversation`'s unique constraint: `phoneNumber` → `@@unique([organizationId, phoneNumber])`.
- [ ] Extend Auth.js `jwt`/`session` callbacks + add proper type augmentation for `organizationId`.
- [ ] Resolve the ~90 query call sites enumerated in §3 (roughly: every service function gains an `organizationId` parameter; every direct-Prisma API route/Server Action reads it from `session.user.organizationId`).
- [ ] Fix the three **pre-existing cross-tenant bugs this audit surfaces independent of the multi-tenancy work itself** — worth fixing even if multi-tenancy were cancelled: (1) `knowledge-base/route.ts:17` returns every document in the DB with no scoping at all; (2) `whatsapp.service.ts:201`'s `prisma.user.findFirst()` grabs a random user for WhatsApp-originated activity attribution; (3) `ticket.service.ts:285`'s WhatsApp conversation count has zero filtering.
- [ ] Add `WHERE "organizationId" = $N` + B-tree index to the RAG similarity search (§4).
- [ ] Decide the WhatsApp routing model (§5) before touching `whatsapp.service.ts` or the webhook route — this is a hard prerequisite, not parallelizable with the rest.
- [ ] Run the backfill migration (§6) against dev data.
- [x] Move `N8N_WEBHOOK_*` resolution from global env vars to per-org config (§7) — only the dispatch step, not the sweep queries. Implemented via a new `OrganizationWebhookConfig` model (one row per org, 5 nullable URL fields — a dedicated table rather than fields on `Organization`, matching the `WhatsAppNumberMapping` precedent); global env vars removed entirely (no Demo Org fallback) since a fallback would contradict §7's "genuinely per-org" principle. Settings UI at `/settings`, OWNER-gated.
- [ ] Add the `Invite` model + `Organization`/self-invite signup flow (§9.1-§9.5), keeping `User.organizationId` **nullable** per §9.6's correction to §6 (`User` is the one exception to "make it required").
- [ ] Add `OrganizationRole` enum + `User.role`/`Invite.role` (§9.6), extend the `jwt`/`session` callbacks and type augmentation once more for `role` (same mechanism as `organizationId`, not a new one), and gate exactly one call site — `sendInviteAction` — on `session.user.role === "OWNER"`. No role checks anywhere else.
