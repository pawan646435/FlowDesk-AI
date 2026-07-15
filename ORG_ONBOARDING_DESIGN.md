# Organization Onboarding & Role-Differentiated Dashboards — Design

This document builds directly on `MULTI_TENANCY_DESIGN.md` (referred to throughout as "the
multi-tenancy doc"), which is already fully implemented: `Organization`, `Invite`,
`OrganizationRole` (`OWNER`/`MEMBER`), the `/create-organization` self-invitation flow, and
`/accept-invite`. Nothing here proposes changing any of that mechanism — this is additive:
richer signup data collection, bulk invites at creation time, role-differentiated dashboard
*content* (not permissions), and landing-page clarity.

Three sections, matching the brief. Each ends with its own open-decisions list, consistent
with the multi-tenancy doc's own convention of flagging rather than silently deciding.

---

## 0. A finding that shapes both §1 and §2, stated up front

While reading the current implementation to ground this doc, I found something the
multi-tenancy doc's own text doesn't fully anticipate, worth surfacing before either section
below, because it changes what's realistic to propose.

**§8 of the multi-tenancy doc states**: *"every user in an org can see and act on all of that
org's tickets, same as today's single-tenant behavior."* That's the stated design intent. But
the actual implemented queries don't do that. `ticket.service.ts`'s `getTickets`,
`getTicketStats`, and `getQueueTickets` — the functions backing `/dashboard` and `/tickets`
today — all filter by **both** `userId` and `organizationId`:

```ts
export async function getTickets(userId: string, organizationId: string, status?: TicketStatus) {
  return prisma.ticket.findMany({
    where: { userId, organizationId, ...(status ? { status } : {}) },
    ...
  });
}
```

This `userId` filter predates multi-tenancy — it's carried over from the app's original
single-tenant "my tickets" behavior, and multi-tenancy's query-scoping work (per that doc's
§3) added `organizationId` alongside it without revisiting whether the `userId` filter still
made sense. The practical effect today: **every existing user, OWNER or MEMBER, already only
ever sees tickets they personally created** — not org-wide. `Ticket.userId` is the *creator*
(the FlowDesk user who filed the ticket via the web form, or a synthetic per-org system user
for WhatsApp-originated tickets — see multi-tenancy doc's bug-fix notes on
`whatsapp.service.ts`), never an assignee. There is **no per-agent ticket assignment field**
anywhere in the schema (confirmed: `Ticket` has no `assignedTo`/`agentId` column).

This matters for both sections below:
- §1's richer org-creation form doesn't touch this, but it's worth knowing the org an OWNER
  just created will, by default, show them a dashboard scoped to *their own* activity only —
  the same as anyone else — until §2's OWNER-specific query change ships.
- §2's "OWNER sees org-wide, MEMBER sees their own work" design is **not** "add a role check
  in front of an existing org-wide view" (no such view exists yet) — it's "build one new
  org-wide-unscoped-by-userId query path for OWNER, and keep the existing userId-scoped path
  for MEMBER." That's a materially different, larger piece of work than it might sound like
  from the brief alone, and §2 designs it accordingly.

**Open decision (flagging, not resolving in this doc)**: is the current userId-filtering
actually the intended single-tenant-carryover behavior, or is it itself a bug that should be
fixed independent of this doc (i.e., should *every* user, not just OWNER, see all org tickets
today, matching what the multi-tenancy doc's §8 already claims is true)? §2 below designs
around the current *actual* behavior (MEMBER = own tickets, OWNER = org-wide) since that's a
defensible product shape on its own merits, not just a workaround — but if the intent was
always "everyone sees everything, no role distinction," that's a smaller, different change
(delete the `userId` filter entirely, no role check needed) and worth deciding explicitly
before implementation, since it changes §2's scope substantially.

---

## 1. Richer organization creation form

### 1.1 What exists today

`/create-organization` (`src/app/create-organization/page.tsx`) collects exactly two fields —
`orgName` and `email` — via `createOrganizationAction` → `createOrganizationWithSelfInvite`
(`organization.service.ts`), which creates the `Organization` row and one `Invite`
(`role: OWNER`) targeting the typed email. No `User` row is created at this point; the invite
is consumed later via the existing `jwt` callback path when the creator actually signs in with
Google (multi-tenancy doc §9.3).

### 1.2 Proposed field set

Following the brief's instruction not to over-collect: the goal is "feels like a real company
onboarding," not "capture every field a enterprise CRM would." Proposed fields, each with a
one-line justification for why it earns its place:

| Field | Type | Required? | Why it's worth collecting |
|---|---|---|---|
| Company name | text (existing `orgName`, renamed for clarity) | Yes | Already exists. |
| Creator email | email (existing `email`) | Yes | Already exists. |
| Industry / category | enum select (see below) | Yes | Cheap to collect, plausible use later (e.g. tailoring AI ticket categorization prompts per-industry, or just display context on the OWNER dashboard's org header) — but see open decision below on whether it does anything yet. |
| Company size | enum select (see below) | Yes | Same reasoning — also a very standard onboarding-flow field, contributes real "this feels like a real signup" texture the brief asked for. |
| Company website | URL, optional | No | Low-friction, gives a company identity beyond a name; genuinely optional since not every org has one at signup time. |

Explicitly **not** proposing: phone number, physical address, company logo upload, job
title/role of the creator (redundant — they're always OWNER by construction), "how did you
hear about us," or any multi-step wizard. Those tip into "collecting to seem thorough" rather
than fields with a real, near-term use — the brief explicitly warned against that.

**Industry enum** — proposed values (a `CompanyIndustry` Prisma enum, matching the existing
`OrganizationRole`/`TicketCategory` enum pattern already in the schema):
`SOFTWARE_TECH`, `ECOMMERCE_RETAIL`, `FINANCE_BANKING`, `HEALTHCARE`, `EDUCATION`,
`HOSPITALITY_TRAVEL`, `MEDIA_ENTERTAINMENT`, `PROFESSIONAL_SERVICES`, `OTHER`. Kept short and
generic rather than exhaustive — `OTHER` is the deliberate escape hatch rather than trying to
enumerate every possible business category.

**Company size enum** — proposed values (a `CompanySize` enum): `SIZE_1_10`, `SIZE_11_50`,
`SIZE_51_200`, `SIZE_201_1000`, `SIZE_1000_PLUS`. Standard SaaS-onboarding bucket ranges.

### 1.3 Schema additions

```prisma
enum CompanyIndustry {
  SOFTWARE_TECH
  ECOMMERCE_RETAIL
  FINANCE_BANKING
  HEALTHCARE
  EDUCATION
  HOSPITALITY_TRAVEL
  MEDIA_ENTERTAINMENT
  PROFESSIONAL_SERVICES
  OTHER
}

enum CompanySize {
  SIZE_1_10
  SIZE_11_50
  SIZE_51_200
  SIZE_201_1000
  SIZE_1000_PLUS
}

model Organization {
  // ...existing fields unchanged...
  industry CompanyIndustry?
  size     CompanySize?
  website  String?
}
```

All three nullable — existing orgs (the Demo Org, and any created before this ships) simply
have `null` here; no backfill required, no `NOT NULL` migration risk. `industry`/`size` are
proposed as `NOT NULL` at the *application* layer (the create-organization form requires
them per §1.2's table) but nullable at the *schema* layer, matching the multi-tenancy doc's
established pattern of "the form enforces required-ness, the column stays permissive" (see
`User.organizationId` reasoning in that doc's §9.6) — this avoids ever needing a schema
migration if a future non-form code path (a script, an admin tool) needs to create an
`Organization` without these fields.

### 1.4 Bulk invites at creation time

**The mechanism**: `createOrganizationAction` currently calls
`createOrganizationWithSelfInvite(orgName, email)` once. Proposed: the form gains a
repeatable "teammate email" input (add/remove rows, client-side — no server round-trip per
row), and the Server Action, after creating the org and the creator's own `Invite`
(unchanged), loops over the additional emails and calls the **already-existing**
`createTeamInvite(organizationId, invitedById, email)` for each one.

**The one wrinkle, and how it's resolved without touching the consumption path**:
`createTeamInvite`'s signature requires `invitedById` — a real `User.id` — because it's
normally called from `/settings` by an already-signed-in OWNER (multi-tenancy doc §9.6). At
org-creation time, **no `User` row exists yet** for the creator (same reason
`Invite.invitedById` was made nullable for the self-invite case in the first place — see that
model's schema comment). So the bulk-invite loop cannot call `createTeamInvite` as-is; it
needs a variant that also tolerates `invitedById: null`.

Proposed: extract the row-creation logic `createTeamInvite` already has into a lower-level
function that takes an optional `invitedById`, and have both `createOrganizationWithSelfInvite`
(for the creator's own OWNER invite, already null today) and the new bulk-invite loop use it
with `invitedById: null`:

```ts
// organization.service.ts — proposed addition, not a replacement of createTeamInvite,
// which keeps its existing signature/behavior for the /settings single-invite case.
async function createInviteRow(
  organizationId: string,
  email: string,
  role: OrganizationRole,
  invitedById: string | null
) {
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return prisma.invite.upsert({
    where: { organizationId_email: { organizationId, email } },
    update: { token, expiresAt, invitedById, acceptedAt: null, role },
    create: { email, organizationId, token, invitedById, role, expiresAt },
  });
}

export async function createOrganizationWithSelfInviteAndTeam(
  orgName: string,
  creatorEmail: string,
  companyDetails: { industry: CompanyIndustry; size: CompanySize; website?: string },
  teammateEmails: string[]
) {
  const slug = await uniqueSlug(orgName);
  const organization = await prisma.organization.create({
    data: { name: orgName, slug, ...companyDetails },
  });

  const ownerInvite = await createInviteRow(organization.id, creatorEmail, OrganizationRole.OWNER, null);

  // Dedupe defensively — the client already prevents duplicate rows in the UI, but a
  // duplicate submission (double-click, retried request) shouldn't create two Invite
  // rows for the same email; @@unique([organizationId, email]) would reject the second
  // one anyway, but upsert (via createInviteRow) makes that a no-op refresh instead of
  // a thrown constraint error.
  const uniqueTeammateEmails = [...new Set(teammateEmails.filter((e) => e !== creatorEmail))];
  const teamInvites = await Promise.all(
    uniqueTeammateEmails.map((email) => createInviteRow(organization.id, email, OrganizationRole.MEMBER, null))
  );

  return { organization, ownerInvite, teamInvites };
}
```

**Confirming the "no change to consumption" requirement**: the `jwt` callback
(`src/auth.ts`) consumes an `Invite` by looking it up **by email** —
`prisma.invite.findFirst({ where: { email: user.email, acceptedAt: null, expiresAt: { gt: new Date() } } })`
— it has no idea whether `invitedById` is null or a real user id, and no idea whether the
invite was created via `/create-organization`'s bulk loop, the original single-teammate
`/settings` flow, or anywhere else. **Zero changes needed to `src/auth.ts` or the
`/accept-invite` page.** This was true by construction (the multi-tenancy doc's §9.3 already
designed invite consumption to be indifferent to *how* the `Invite` row came to exist), and
this section's design deliberately preserves that — it's the reason a lower-level
`createInviteRow` was factored out rather than teaching `createTeamInvite` itself to accept a
list, which would have coupled the bulk-creation-time case to the single-settings-page case
unnecessarily.

**What happens if a teammate email is invalid, or already belongs to another org's pending
invite, or matches an existing `User`?** — `sendInviteSchema`'s per-field email validation
(`z.string().email()`) already rejects malformed addresses client-side before submission.
Same-email-different-org and already-a-`User` cases are not new — they're the exact same
edge cases the multi-tenancy doc's §9.2 already noted and deliberately didn't solve further
("a real edge case... this design doesn't need to solve given §2's existing one-org-per-user
decision") for the single-invite `/settings` flow; nothing about doing N of them at once
changes that reasoning.

### 1.5 UI shape

Single-page form (not a multi-step wizard — keeps this consistent with the existing
single-page `/create-organization`), sectioned visually:
1. Company details (name, industry select, size select, website) — reusing the existing
   `glass`/`border-border/40` card styling from `create-organization/page.tsx`.
2. Your email (unchanged from today).
3. "Invite your team" (optional) — a dynamic list of email inputs with an "+ Add teammate"
   button and a remove (×) button per row, client component (`"use client"`), matching the
   add/remove-row interaction pattern already used in this app's dialog components (e.g.
   `create-ticket-dialog.tsx`'s modal open/close state handling, though this is a plain
   section, not a dialog).

### 1.6 Open decisions — §1

1. **Do `industry`/`size` do anything yet, or are they purely descriptive?** This design
   proposes collecting them because the brief asked for "a more realistic onboarding feel,"
   but doesn't propose any behavior change based on their values (no industry-specific AI
   prompts, no size-based feature gating) — that would be new scope beyond "collect the
   field." Worth deciding whether to display them anywhere in the product (e.g. an "Org
   Profile" read-only section on `/settings`) as part of this work, or leave them
   write-only until a real use emerges. Leaning toward: display-only on `/settings`, cheap
   to add, avoids the field feeling pointless — but flagging rather than deciding, since it's
   additional UI surface not explicitly requested.
2. **Cap on teammate invites per submission?** Unbounded rows technically works
   (`Promise.all` over however many emails), but a client-side UX cap (e.g. 20) is worth
   having so someone doesn't accidentally paste a huge list and create an equally huge
   number of `Invite` rows in one request. Not designing the exact number here — just
   flagging that *some* cap should exist before shipping, since none is proposed above.
3. **Company size/industry validation strictness**: proposed as required dropdowns above,
   but should "prefer not to say" be a valid enum value, or should these genuinely be
   mandatory? Leaning toward making them required (keeps the enum simple, avoids a footgun
   nullable-in-practice value), but noting the alternative.

---

## 2. Role-differentiated dashboards

### 2.1 Scope correction from the brief, per §0's finding

The brief frames this as "OWNER gets org-wide, MEMBER gets a focused personal view" — and
confirms MEMBER's view should be built around what's realistically available today (shared
queue, personal activity, recent tickets touched) rather than inventing per-agent assignment.
Per §0, this maps cleanly onto the actual codebase:

- **MEMBER's dashboard is, almost verbatim, today's existing `/dashboard`** — since today's
  `/dashboard` already only shows the logged-in user's own tickets/activity (the `userId`
  filter), that page's current content *is* already a reasonable "MEMBER" dashboard. Very
  little new code needed here.
- **OWNER's dashboard is genuinely new** — an org-wide view has no existing query to reuse
  as-is; the `userId` filter needs to be droppable for OWNER specifically, and several new
  widgets (team overview, integration health) have no precedent in the current dashboard at
  all.

### 2.2 Where the role check happens

Reuses the exact `session.user.role === "OWNER"` pattern already established in
`src/app/settings/page.tsx` (`const isOwner = session.user.role === "OWNER";`) and
`src/app/settings/team-actions.ts`/`webhook-actions.ts`'s Server Action gates. No new
mechanism — `session.user.role` is already typed (`OrganizationRole | null`) via the module
augmentation in `src/types/next-auth.d.ts`, already populated by the `session` callback in
`src/auth.ts`. `DashboardPage` (a Server Component) reads `session.user.role` once, same as
it already reads `session.user.id`/`organizationId`, and branches which data-fetching
functions to call and which widget set to render.

**This is explicitly a content/query difference, not a permissions/authorization
difference** — consistent with the multi-tenancy doc's §9.6 closing statement: *"role is
read in exactly one place... nowhere else... no OWNER-only ticket view."* That line is worth
being precise about here: it means no *authorization* check should ever prevent a MEMBER
from viewing a specific ticket or piece of data they'd otherwise be allowed to see (there is
no such restriction today, and this design doesn't add one) — it does **not** mean the
dashboard's *summary/landing content* can't legitimately differ by role. An OWNER dashboard
showing org-wide ticket counts is a different *view* of data every MEMBER can already reach
individually (by clicking into `/tickets` for tickets they can see, which — per §0 — is
currently also `userId`-scoped for everyone, OWNER included, until this section's OWNER
query path ships). Flagging this distinction explicitly since it's easy to conflate "role
affects what's shown by default" with "role affects what's authorized," and the multi-tenancy
doc was deliberately strict about ruling out the latter.

### 2.3 OWNER dashboard — widgets and their data sources

| Widget | New or reused? | Data source |
|---|---|---|
| Org-wide stats cards (Total/Open/Resolved/SLA-breached tickets) | **New query**, reuses existing card UI | New: `getOrgWideTicketStats(organizationId)` — same shape as existing `getTicketStats`, but its Prisma `where` clauses drop `userId` entirely, keeping only `organizationId`. Proposed as a new function rather than an optional-`userId` parameter on the existing one, to keep each function's contract unambiguous (see open decision below). |
| SLA & Performance Metrics | **New query**, reused UI | New: `getOrgWideSLAStats(organizationId)` — same relationship to existing `getSLADashboardStats` as above. |
| Tickets by Category / AI Sentiment Distribution | **New query**, reused UI | Same treatment — org-wide versions of the existing category/sentiment breakdowns already computed inside `getTicketStats`. |
| **Team overview** (new widget) | New | Reuses `getOrganizationMembers(organizationId)` — **already exists** (`organization.service.ts`, built for `/settings`'s member list). Render as a compact list/table: name, email, role badge (same `Crown` icon treatment already used in `/settings`), and — if available — a per-member open-ticket count (`Ticket.groupBy({ by: ["userId"], where: { organizationId, status: { not: RESOLVED } }, _count: true })`, one extra query). |
| **Integration health** (new widget) | New | Reuses `getOrganizationWebhookConfig(organizationId)` (exists, built for `/settings`) — render as a simple checklist: which of the 5 n8n webhook URLs are configured (✓/✗ per event type, not a live reachability check — that would require an actual outbound request from a dashboard page load, which is a different and heavier feature). Reuses `WhatsAppNumberMapping` lookup (`prisma.whatsAppNumberMapping.findFirst({ where: { organizationId } })`, no existing service function — needs a one-line addition, e.g. to `organization.service.ts`) to show whether a WhatsApp number is mapped to this org yet. |
| WhatsApp Channel Analytics | **New query**, reused UI | Org-wide version of the existing WhatsApp stats already inside `getTicketStats` — same treatment as the stats cards above. |
| Recent Tickets / Activity Timeline | **New query**, reused UI | Org-wide versions of `getTickets`/`getRecentActivities`, `organizationId`-only `where` clause. |

**Net new service-layer surface**: a small number of "org-wide" sibling functions
(`getOrgWideTicketStats`, `getOrgWideSLAStats`, org-wide `getTickets`/`getRecentActivities`
variants) plus one small addition to `organization.service.ts` for the WhatsApp mapping
lookup. No new UI components — every widget above reuses the exact card/list/timeline JSX
already in `dashboard/page.tsx`, just fed by different data.

### 2.4 MEMBER dashboard — widgets and their data sources

Per §2.1, this is deliberately close to today's `/dashboard` as it already exists — the brief
explicitly asked not to invent a per-agent-assignment feature that doesn't exist, and the
existing `userId`-scoped queries already deliver exactly "here's my work":

| Widget | Data source |
|---|---|
| Personal stats cards (My Total/Open/Resolved/SLA-breached tickets) | **Unchanged** — `getTicketStats(userId, organizationId)`, exactly as today. |
| My SLA & Performance Metrics | **Unchanged** — `getSLADashboardStats(userId, organizationId)`, exactly as today. |
| My Tickets by Category / Sentiment | **Unchanged** — same source, no change. |
| **Shared queue link** (new, small addition) | Not a new query — a prominent link/card pointing at `/tickets/queue`, which already exists and already lists all *the logged-in user's* non-resolved tickets (`getQueueTickets`, also `userId`-scoped today — see §0's open decision on whether that's correct). Framed here as "your active queue" rather than implying it's the whole org's queue, since — per §0 — it currently isn't. |
| My Recent Tickets / My Activity Timeline | **Unchanged** — `getTickets`/`getRecentActivities`, exactly as today. |
| WhatsApp Channel Analytics | **Unchanged**, or optionally dropped for MEMBER (see open decision below) — today's version is already org-wide (`stats.whatsAppConversationCount` etc. come from `getTicketStats`'s WhatsApp counts, which are `organizationId`-scoped, not `userId`-scoped, per the multi-tenancy doc's WhatsApp-scoping work) — so this one widget is *already* effectively "team-wide" data appearing on every user's dashboard today, OWNER or MEMBER, which is a minor pre-existing inconsistency with the "MEMBER sees only their own work" framing this section otherwise establishes. |

**Practical implication**: `DashboardPage` becomes close to today's file with a role branch
at the top choosing which set of service functions to call, not two entirely separate page
files — most of the JSX (card layout, timeline rendering) is identical between roles and
should stay one component, parameterized by which data it received, rather than duplicated.

### 2.5 Open decisions — §2

1. **The WhatsApp Analytics widget inconsistency noted in §2.4** — should it move to
   OWNER-only (since it's genuinely org-wide data, and showing it to MEMBER contradicts the
   "personal view" framing), or is "everyone sees aggregate channel health" fine to keep
   as shared context regardless of role? Not deciding here; either is defensible.
2. **Per-member open-ticket count in the Team Overview widget (§2.3)** — proposed as "if
   available," meaning it's a nice-to-have one extra query, not a hard requirement. Worth
   confirming whether it's worth the extra `groupBy` query on every OWNER dashboard load, or
   whether member role/email alone is enough for a first version.
3. **Should the org-wide stats functions be new functions (as proposed) or should the
   existing functions take an optional `scopeToUser: boolean` / make `userId` optional?**
   Proposing new functions (`getOrgWideTicketStats` etc.) specifically to avoid a function
   whose behavior silently changes based on whether an optional parameter was passed — but
   this does mean near-duplicate query logic living in two places per stat. A shared
   internal helper parameterized by an optional `userId` (used by both the public
   `userId`-required and `organizationId`-only entry points) would reduce duplication while
   keeping both public contracts explicit — worth deciding at implementation time rather than
   locking in either approach now.
4. **§0's larger open decision** (does MEMBER's ticket visibility being `userId`-scoped
   reflect true intent, or is it a bug) directly determines how much of this section is "add
   an OWNER-only new view" versus "the whole app's ticket visibility model needs revisiting
   first." This design assumes the former for planning purposes but that assumption should
   be confirmed before implementation starts.

---

## 3. Landing / entry page clarity

### 3.1 What exists today

`src/app/page.tsx`'s single CTA: `<Link href={session ? "/dashboard" : "/login"}>` labeled
"Get Started Now" (or "Go to Dashboard" if already authenticated). There is no path from the
landing page that distinguishes "I'm starting a new company" from "I already have
access/an invite" — a first-time visitor has to already know `/create-organization` exists as
a URL, or land on `/login` and get confused about why signing in with Google doesn't work
for them yet (this is exactly the `AccessDenied` rejection path the multi-tenancy doc's §9.4
designed on purpose).

### 3.2 Proposed two-CTA design

Replace the single CTA with two, side by side, equally weighted (deliberately **not**
primary/secondary styling — visually implying "the real button is X, this other one is a
lesser option" would misrepresent that both are equally valid entry points for different
people):

- **"Create your organization"** → `/create-organization`. Framed as: "Setting up FlowDesk AI
  for your company for the first time."
- **"Sign in"** → `/login`. Framed as: "Already have an account, or have an invite link from
  your team."

Both reuse the existing button styling already present in `page.tsx` (the `glow-purple`
primary button treatment) — proposing them as two visually equal buttons side-by-side (or
stacked on mobile), not one primary CTA plus a text link, since the brief's intent is that
these are two *equally first-class* entry points, not "sign up is the main flow and sign-in
is secondary" (which would misrepresent that most real visits, once the product has existing
customers, will be sign-ins, not new-org creations).

If already authenticated (`session` truthy), the existing single "Go to Dashboard" behavior
is unchanged — the two-CTA choice only matters for a logged-out visitor.

### 3.3 Why no third "employee login" button — the actual reasoning to preserve

Explicitly designing this out, and explaining why, so it isn't reintroduced later by someone
who reasonably assumes "we have owners and members, surely each needs their own entry point"
without re-deriving why that doesn't hold:

**A first-time employee (someone who has never signed in before) cannot authenticate through
any generic "login" path — full stop.** Per the multi-tenancy doc's §9.4 (the `signIn`
callback) and the account-linking security fix documented in that same work: sign-in is
**denied by default** for any Google account with no existing `User` row and no matching,
unexpired, unaccepted `Invite`. There is no username/password, no "request access" self-serve
path, and deliberately no `allowDangerousEmailAccountLinking` — a first-time employee's *only*
route in is clicking the specific `/accept-invite?token=...` link their OWNER (or another
MEMBER, since inviting is currently OWNER-gated per §9.6 but MEMBER-eligibility for inviting
was flagged, not decided, in that doc's §9.1) sent them. That link **is** their login path —
a generic "Employee Login" button pointing at `/login` would either:

- Do nothing different from the existing "Sign in" button (if they're a *returning* employee
  who already has a `User` row — in which case they don't need a separate button, "Sign in"
  already covers them), or
- Actively mislead a first-time employee into thinking they can self-serve their way in via
  Google sign-in with no invite, when the `signIn` callback will correctly reject them,
  landing them on the `AccessDenied` error page for a reason the button's own label implied
  shouldn't happen.

So "Employee Login" isn't merely redundant with "Sign in" — for the one group of people its
label specifically addresses (brand-new employees), it's actively wrong, since those people's
actual working entry point is a link they receive out-of-band (email, Slack, however their
OWNER shares it), not a button on this page at all. The two-CTA design in §3.2 is exhaustive
for anyone who can reach this page directly: new-company creators use CTA 1, and literally
everyone else who has any legitimate way to authenticate — returning owners, returning
members, and already-onboarded-but-not-yet-signed-in-today employees — use CTA 2. A
first-time invited employee doesn't start at `/` at all; they start at whatever URL was in
their invite.

### 3.4 Open decisions — §3

1. **Should the landing page detect and surface a helpful message for someone who lands on
   `/` with no session and no invite context** (e.g., "Looking for your team's invite link?
   Check your email" as a small note near the "Sign in" CTA)? Not designing specific copy
   here — flagging that some visitors landing on `/` genuinely are waiting on an invite and
   might benefit from a pointer, without adding a third button.
2. **Mobile ordering of the two CTAs** — which comes first when stacked vertically on small
   screens? Leaning "Sign in" first (more visits will be returning users than first-time org
   creators, especially after initial launch), but this is a minor UX call, not resolved here.
