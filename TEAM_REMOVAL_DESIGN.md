# Teammate Removal & Org-Switching — Design

Builds on `MULTI_TENANCY_DESIGN.md` (schema, auth, invite consumption) and
`ORG_ONBOARDING_DESIGN.md` (org-wide ticket visibility, richer onboarding, role-gated
dashboard widgets). Nothing here proposes changing anything already built except the one
specific bug fix in §3 (the `jwt` callback's invite-recheck gap) — everything else is new,
additive functionality: removing/leaving org membership, and letting an already-onboarded
user see and act on an invite to a different org.

No implementation code below — design only, per the brief.

---

## 1. Session staleness — the core hard problem

### 1.1 Confirming the actual mechanism, not assuming it

Traced this directly against `@auth/core`'s source rather than reasoning from the docs, since
getting this wrong would make the rest of this section moot.

**The `jwt` callback's `user` parameter is only ever populated on the initial sign-in call.**
`node_modules/@auth/core/lib/actions/session.js` — the handler behind every `useSession()`
client call and every `auth()` server call once a session cookie already exists — invokes
`callbacks.jwt({ token: payload, session: newSession })` with **no `user` field at all**. This
app's `jwt` callback (`src/auth.ts`) is entirely gated on `if (user) { ... }` — meaning on
every single request after the initial sign-in, that whole block is skipped, and whatever
`organizationId`/`role` was baked into the token at sign-in time is returned unchanged,
**with zero DB read**. This isn't a bug — it's exactly how JWT-strategy sessions are supposed
to work (that's the entire performance point of the strategy) — but it's the mechanical reason
`src/auth.ts`'s current form is *structurally incapable* of ever noticing a removal on its own.
Confirmed default `session.maxAge` is 30 days (`@auth/core`'s `lib/init.js`), unmodified by
this app's config — so today, a removed user's stale session would persist for up to 30 days
unless they happen to sign out.

### 1.2 Weighing the three options honestly

**(a) Shorten JWT `maxAge` significantly.**
Doesn't actually solve anything on its own — `maxAge` only controls when the cookie itself
expires and the browser is forced to a fresh sign-in; it doesn't make the `jwt` callback re-run
DB checks any more often in between. A user with a `maxAge: 5 minutes` session still has a
JWT that's fully self-contained and unchecked against the DB for those 5 minutes, and every
expiry just forces re-authentication via Google's OAuth screen again (`prompt: "select_account"`
per `auth.config.ts`) — repeatedly re-prompting every active user for Google sign-in every
few minutes is a materially worse UX than the problem being solved, for a partial and delayed
fix. **Rejected** — it doesn't address the actual gap (no DB check happens *within* the
window), only shrinks the window, at a real UX cost.

**(b) Switch to database-strategy sessions entirely.**
Would genuinely solve this — database-strategy sessions are looked up by `sessionToken` on
every request, so `getSessionAndUser()` always reflects current DB state (see
`node_modules/@auth/core/lib/actions/session.js`'s non-JWT branch, confirmed above). But this
is a broad structural change: `PrismaAdapter`'s `Session` table becomes load-bearing (it exists
in the schema today but is unused under the `jwt` strategy), every request now does a DB
round-trip just to resolve `auth()` (not just pages that need `organizationId` — literally
every protected-route check, including ones that today only need to know "is this person
logged in"), and the entire `jwt`/`session` callback split in `auth.ts` needs restructuring
since the org/role-assignment logic currently lives in `jwt` specifically because that's the
callback that fires with a populated `user` at sign-in time — under `database` strategy the
equivalent hook is different (`events.signIn`/adapter-level, not `callbacks.jwt`). This is a
correct, more thorough fix, but it re-opens and touches essentially the same surface
`MULTI_TENANCY_DESIGN.md §2` already carefully designed once — not a small change layered on
top of what exists, closer to redoing that section's mechanism from a different foundation. Not
rejecting this outright — flagged as the more thorough option in the open decisions below — but
it's disproportionate to the actual failure mode this design needs to close, which is narrower
than "sessions are never DB-validated at all."

**(c) A lightweight per-request membership check.**
The one option that adds a genuinely small, targeted piece rather than changing the session
strategy. Confirmed where it *can't* live first: `src/middleware.ts` constructs its own
`NextAuth(authConfig)` instance from `auth.config.ts` alone (no Prisma import, no adapter) —
this is deliberate, since Next.js Edge Middleware runs in a runtime that can't open a standard
Postgres connection, and `src/lib/prisma.ts` uses the plain Node `PrismaClient`, not an
edge-compatible driver adapter. So **this check cannot live in middleware as currently
structured** without either adding an edge-compatible DB driver (a real, separate piece of
infrastructure work, out of scope here) or moving it elsewhere. The other natural home — a
Node-runtime location that already runs on every navigation — is a root layout Server
Component (`src/app/layout.tsx`) or, more surgically, each protected page's existing
`auth()`-then-redirect check (which already exists on `/dashboard`, `/tickets`, `/settings`,
etc. — see MULTI_TENANCY_DESIGN.md's query-scoping work). **Recommended.**

### 1.3 The recommendation, concretely

Add one cheap DB read to the existing per-page `auth()` calls (not a new global mechanism):
immediately after resolving `session.user.organizationId` from the token, do a single
`prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true } })`
and compare it against the token's `organizationId`. If they differ (removed, left, or joined a
different org since the token was issued), force a redirect to `/login` — effectively treating
a stale token exactly like an expired one, forcing a fresh sign-in that re-runs the `jwt`
callback's `if (user)` branch properly. This is not a new mechanism bolted onto the app; it's
one extra `select: { organizationId: true }` query (a single indexed column, `User.id` is the
primary key — the cheapest possible read) added at the exact place every protected page already
does its `auth()` + redirect-if-unauthenticated check.

**Why not a "membership version" counter field instead of comparing `organizationId`
directly**, which the brief's framing suggested as an option: comparing the actual
`organizationId` values directly is strictly simpler and requires no new schema field — a
version counter would need incrementing logic added at every place membership changes (removal,
leaving, joining), is one more thing that can be forgotten at a future call site, and gives no
information a direct comparison doesn't already give. Proposing direct comparison, not a
version field, unless a future need for detecting *other* kinds of staleness (e.g. `role`
changes independent of `organizationId`) emerges — in which case comparing `role` too, in the
same query, costs nothing extra (already fetching the row).

**Cost, quantified**: one indexed primary-key lookup per protected-page render. This *is* the
DB round trip the brief asked to quantify against "an earlier performance decision" — the
earlier decision was JWT strategy specifically to avoid a DB hit on every session check
(`useSession()` calls, silent background token refreshes). This proposal does not undo that:
`useSession()` on the client and the token-refresh path in `@auth/core`'s `session.js` action
remain exactly as fast as before (no DB call added there) — the new read only happens inside
Server Components that were *already* about to run at least one org-scoped Prisma query anyway
(every protected page calls `getTickets(organizationId)` or similar immediately after this
check). The marginal cost is one extra trivial indexed lookup per page load, not a new
DB-per-session-check pattern layered onto every `useSession()` call across the app.

### 1.4 Open decisions — §1

1. **Every protected page, or one shared checkpoint?** Proposing "add this to each existing
   `auth()`-then-redirect block" mirrors how the app already checks
   `!session.user?.organizationId` per-page today (no shared middleware-level check for that
   either, since middleware can't reach the DB) — but it does mean N near-identical blocks of
   code rather than one. A small shared helper (e.g. `getVerifiedSession()` in a new or existing
   lib file, wrapping `auth()` + the staleness check + the redirect) would reduce duplication
   without requiring the edge-runtime DB access problem to be solved. Worth doing as part of
   implementation, not deciding the exact helper shape here.
2. **Database-strategy sessions as a later, larger project** — not recommended for *this*
   design's scope, but if org-membership changes need to propagate faster than "next page
   load" in the future (e.g. a live-updating UI, not just correctness-on-next-navigation), that
   would be the point to revisit option (b) properly, as its own dedicated piece of work.
3. **What "stale" means for the Server Action gates** (e.g. `sendInviteAction`,
   `saveWebhookConfigAction`, both already OWNER-gated on `session.user.role`) — these also read
   from the token, not a fresh DB check, so a removed OWNER's already-open browser tab could
   still attempt an OWNER-gated action until they next navigate and hit the check in §1.3.
   Whether Server Actions need the same staleness check inline (not just page-level) is a real
   question — leaning toward yes for the two *mutating* OWNER-only actions specifically (since
   §2 below adds actual authorization consequences to organizationId being stale, not just
   stale display data), but not resolving the exact mechanism here.

---

## 2. Remove/leave mechanics

### 2.1 The Server Action: OWNER removes a MEMBER

New Server Action, `removeMemberAction`, in `src/app/settings/team-actions.ts` (same file as
the existing `sendInviteAction`, since both are team-management actions gated identically).
Auth gate matches the exact existing pattern verbatim:

```ts
const session = await auth();
if (!session || !session.user?.id || !session.user?.organizationId) {
  return { error: "Unauthorized" };
}
if (session.user.role !== "OWNER") {
  return { error: "Only organization owners can remove teammates." };
}
```

Beyond that shared gate, this action needs checks `sendInviteAction` doesn't:

- **The target user must actually be in the caller's org.** Re-fetch the target `User` by id,
  confirm `targetUser.organizationId === session.user.organizationId` before touching anything
  — an OWNER must not be able to clear an arbitrary user's org membership by guessing/tampering
  with a user id from a different org. This is the same "the where clause re-checks org
  membership" discipline `MULTI_TENANCY_DESIGN.md §3` established for every other org-scoped
  mutation.
- **Cannot remove an OWNER via this action.** `removeMemberAction` only ever operates on
  `MEMBER`-role users. If the target is an `OWNER` (including the caller removing someone
  else who's also an OWNER, if a future multi-owner scenario exists — see the "can there be
  more than one OWNER" note in §2.3), this action refuses. Removing an OWNER is a
  fundamentally different, riskier operation (§2.3 below) and deliberately kept as a separate
  code path with its own extra guardrail, not a variant of the same button.

**The removal itself** — a single field update, not a `User` deletion (critical: see §4/§5's
findings on why deleting the row would be actively harmful):

```ts
await prisma.user.update({
  where: { id: targetUserId },
  data: { organizationId: null, role: null },
});
```

This is deliberately the exact inverse of what the `jwt` callback's invite-consumption branch
writes (`organizationId: invite.organizationId, role: invite.role`) — removal returns a user to
precisely the same "orgless" state a brand-new sign-in with no invite would leave them in,
reusing a state the rest of the system (the `signIn` callback's `existingUser` branch, `jwt`'s
`if (user.organizationId)` check) already knows how to handle correctly, rather than inventing
a new "removed" state that every other check would need to learn about.

### 2.2 Can a MEMBER voluntarily leave?

Yes — proposing a second, simpler Server Action, `leaveOrganizationAction`, callable by any
`MEMBER` (not `OWNER` — see §2.3) on themselves:

```ts
const session = await auth();
if (!session || !session.user?.id || !session.user?.organizationId) {
  return { error: "Unauthorized" };
}
if (session.user.role === "OWNER") {
  return { error: "Organization owners must transfer ownership before leaving. Contact support." };
  // — or whatever §2.3's resolution ends up being; see open decision below.
}
await prisma.user.update({
  where: { id: session.user.id },
  data: { organizationId: null, role: null },
});
```

No cross-user authorization check needed here (unlike `removeMemberAction`) — a user acting on
their own `session.user.id` needs no additional "is this really my own row" verification, that's
inherent to using the session's own id rather than a passed-in target id.

### 2.3 Resolving the OWNER edge case — closing the gap, not deferring it again

`MULTI_TENANCY_DESIGN.md §9.6` explicitly left one thing undecided while flagging the guardrail
that must hold once removal exists: *"whenever a remove/deactivate member feature is eventually
designed, it must refuse to remove or demote an org's last remaining OWNER."* This is that
feature. Resolving it now, directly:

**Can an OWNER remove themselves, or leave?** Only if doing so would not leave the org with
zero OWNERs. Since this design's current schema (confirmed against `prisma/schema.prisma`) has
exactly one `OWNER` per org in every case that's actually reachable through the app today (the
self-invite flow assigns exactly one OWNER at org-creation time; `sendInviteAction` always
creates `MEMBER`-role invites, never OWNER; there is no "promote a MEMBER to OWNER" action
anywhere in the app) — **in practice, every org currently has exactly one OWNER, so "remove
themselves" and "the last remaining OWNER leaves" are the same event, always.** The correct,
minimal fix: **block it outright.** Neither `removeMemberAction` nor `leaveOrganizationAction`
allow an `OWNER` target, full stop — not "block only if they're the last one," since there is no
code path today that produces a second OWNER to fall back to. The check is simply
`if (targetUser.role === "OWNER") return { error: "..." }`, no count query needed, because the
count is always 1 by construction.

This closes the gap the earlier doc left open **without** building a promotion/transfer-ownership
UI — exactly the "don't over-design for a scenario the app can't reach" reasoning
`MULTI_TENANCY_DESIGN.md §9.6` already applied, extended one step further now that removal
actually exists: the guardrail isn't "count OWNERs and block if it'd hit zero" (which would
require a query and would technically permit removal in some hypothetical multi-OWNER future),
it's "an OWNER cannot be removed or leave via these two actions, period" — simpler, and
airtight given today's one-OWNER-per-org invariant.

**What if someone genuinely needs to transfer ownership** (the OWNER is leaving the company for
real)? Not designed here — same reasoning as before: no trigger path through the app makes this
urgent to solve now, and the break-glass answer (a direct DB `UPDATE` setting a different
member's `role` to `OWNER`, then that former-OWNER's row can go through the normal member-removal
path) remains available exactly as `MULTI_TENANCY_DESIGN.md §9.6` already noted. Flagging this
explicitly as still out of scope, not silently reopening it.

### 2.4 UI surface

`/settings`'s existing "Team members" list (`src/app/settings/page.tsx`) gains a remove button
per row, visible only when `isOwner && member.role !== "OWNER"` (client-side visibility mirrors
the server-side gate, not a substitute for it) — reusing the existing member-row layout, adding
one action button matching the existing button styling conventions (e.g. the destructive-red
treatment already used for "Sign Out" in `navbar.tsx`). A MEMBER viewing their own settings page
sees a "Leave organization" action instead (not shown to OWNER, matching §2.3's block).

### 2.5 Open decisions — §2

1. **Confirmation step before removal/leaving** — a destructive-ish action (loses access to
   the org's tickets/knowledge base immediately). Proposing a simple browser-native `confirm()`
   or a lightweight inline "are you sure" toggle, not a full modal dialog — but not designing
   the exact UX here.
2. **Does the removed/leaving member's browser session need to be force-invalidated
   immediately, or is §1's next-page-load check sufficient?** This design assumes §1's
   mechanism is sufficient (the next navigation catches it) — an actively-open tab mid-session
   for the removed user isn't instantly kicked out, only blocked from their *next* navigation.
   Flagging as acceptable per §1's own scope (this design explicitly didn't pursue true
   real-time invalidation via database-strategy sessions), not silently assuming it's a
   non-issue.

---

## 3. Pending invite visibility for already-onboarded users

### 3.1 The actual bug, confirmed against the current code

`src/auth.ts`'s `jwt` callback:

```ts
if (user.organizationId) {
  // Returning user who already belongs to an org.
  token.organizationId = user.organizationId;
  token.role = user.role ?? null;
} else if (user.email) {
  // ...only here does it ever look up a pending Invite...
}
```

Confirmed exactly as described in the brief: once `user.organizationId` is truthy, the entire
invite-lookup branch is unreachable, permanently, regardless of whether a new `Invite` row
targeting that same email later gets created for a *different* org. This is a real, live gap —
not hypothetical — since `ORG_ONBOARDING_DESIGN.md`'s bulk-invite-at-creation-time feature makes
inviting an email that's plausibly already a `User` elsewhere (a real company's employee who's
already using FlowDesk AI for a different org) an entirely ordinary occurrence, not an edge case.

### 3.2 Fix: surface pending invites without silently switching orgs

**Do not fix this inside the `jwt` callback at all.** The `jwt` callback's job is narrowly
"resolve what `organizationId`/`role` this token should carry" — silently switching a user's org
mid-session because a new invite happens to exist would violate this design's own requirement
(§3, "must explicitly leave their current org before joining the new one... not a silent
org-switch") and would be a surprising, invisible side effect of the *sign-in* action rather
than something the user consciously did. Fix stays entirely additive and separate:

- New service function, `getPendingInvitesForUser(email: string)` — `prisma.invite.findMany({
  where: { email, acceptedAt: null, expiresAt: { gt: new Date() } }, include: { organization:
  true } })`. Independent of `User.organizationId` entirely; works identically whether the user
  has an org or not.
- Called from a Server Component that already has the user's email available — either a small
  new section on `/settings` ("Pending Invites"), or a dismissible banner on `/dashboard`,
  or both. Leaning toward `/settings` as the primary location (it's already the
  team/org-management page) with an optional dashboard banner as a discoverability nudge —
  see open decision below.
- **Rendering**: for each pending invite found, show the target org's name and a "View" or
  "Switch to this org" action. If the viewer currently has no org (`session.user.organizationId`
  is null), this reduces to the existing `/accept-invite?token=...` flow unchanged — nothing new
  needed there, since an orgless user hitting the invite link already works correctly today. If
  the viewer **does** have an org already, clicking through requires the explicit
  leave-then-join flow below.

### 3.3 The explicit leave-then-join confirmation

New page or dialog (not silently reusing `/accept-invite` as-is, since that page's current copy
and single "Continue with Google" button assumes the visitor has no session yet — see
`src/app/accept-invite/page.tsx`'s existing `existingSession?.user?.id` branch, which today
shows "you're already signed in, sign out first" for *any* existing session, regardless of
whether that session belongs to an org or not).

Proposing: extend `/accept-invite`'s existing "already signed in" branch (§ referenced above,
already built during the account-linking security fix) with one more case. Today it has two
branches — no session (show "Continue with Google") and any existing session (show "sign out
first"). Add a third, more specific one: **existing session AND that session's org differs from
the invite's target org** → show "You're signed in to `<Current Org>`. Accepting this invite to
join `<New Org>` will remove you from `<Current Org>` first — you cannot belong to both.
[Leave `<Current Org>` and join `<New Org>`]" — a single explicit confirming button, not a
silent redirect. Clicking it calls a new combined Server Action that does the leave (§2.2's
`leaveOrganizationAction` logic, minus the OWNER block re-check since this path already implies
MEMBER — an OWNER with a pending invite elsewhere still can't leave, consistent with §2.3) and
then lets the existing `jwt`/invite-consumption path do the actual join on next sign-in — or,
more directly, performs both the leave (`organizationId: null`) and the join
(`organizationId: invite.organizationId, role: invite.role`, `Invite.acceptedAt`) in one
`$transaction`, matching the existing transactional pattern `auth.ts`'s `jwt` callback already
uses for the ordinary join case. Doing both in one transaction avoids a moment where the user is
orgless between the two steps if anything fails partway.

**Why this doesn't touch the `jwt` callback**: since the user already has a session (they're
mid-flow, clicking a real button on `/accept-invite`, not going through Google OAuth again),
this is a direct Server Action mutating the DB and then requiring the user to get a fresh
session (redirect to `/login`, forcing sign-out-and-back-in, or use `signOut` +
`redirectTo` matching the pattern already established for the account-linking fix) so the
*next* `jwt` run picks up the new `organizationId` cleanly via the normal path — not a special
case bolted into `jwt` itself.

### 3.4 Open decisions — §3

1. **Where exactly does "Pending Invites" live** — `/settings` only, a dashboard banner only,
   or both? Leaning toward `/settings` as primary (avoids adding visual noise to the dashboard
   for the common case of zero pending invites) with a small banner only when at least one
   exists, but not committing to the exact placement here.
2. **What if the invite is for an OWNER role at the new org, but the person is currently a
   MEMBER elsewhere?** Nothing about §2.3's OWNER-can't-leave block applies here — that block is
   specifically about *leaving without a plan*, not about *becoming an OWNER somewhere else*. A
   MEMBER accepting an OWNER-role invite elsewhere should work exactly like any other
   leave-then-join, since they're not currently an OWNER anywhere, so §2.3's invariant isn't at
   risk. Confirming this explicitly rather than leaving it ambiguous, but not proposing any
   different mechanism.

---

## 4. Historical data integrity — confirmed, not assumed

Traced directly against `prisma/schema.prisma` rather than asserting this holds:

- **`Ticket.organizationId`** (line ~95) and **`Activity.organizationId`** (line ~117) are both
  **independent columns**, not derived through `userId` at read time or maintained by any
  cascade/trigger tied to `User.organizationId`. They're set once, at creation time
  (`ticket.service.ts`'s `createTicket`, `activity.service.ts`), and never touched again by
  anything in the current codebase. Clearing `User.organizationId` (§2's removal mechanism)
  **cannot** alter either of these fields — there is no relation path from `User.organizationId`
  to them at all, so there's structurally nothing that *could* cascade.
- **The one real hazard, and why §2's design specifically avoids it**: `Ticket.user` (line ~99)
  and `Activity.user` (line ~120) both have `onDelete: Cascade`. If a `User` **row** were ever
  deleted (not just its `organizationId` cleared), every ticket and activity that user created
  would be deleted too — silently destroying that org's ticket history. This is exactly why §2.1
  and §2.2 both specify `prisma.user.update({ data: { organizationId: null, role: null } })`,
  never `prisma.user.delete(...)` — the removal mechanism must never delete the `User` row,
  precisely to keep this cascade from ever triggering. Calling this out explicitly as the thing
  that must never change if this design is implemented differently later: **removal is always a
  field update, never a row deletion.**
- **No explicit protection needed beyond "don't delete the row"** — since the columns are
  already structurally independent, there's nothing additional to add (no extra
  `onDelete: SetNull`, no denormalization). The independence is already correct as built.

---

## 5. Org-level config and invites-sent — what happens when an OWNER is removed or leaves

Per §2.3, an OWNER can never actually be removed or leave through the two Server Actions this
design proposes — so this section is more "confirm nothing would break if it somehow happened
via the break-glass DB path §2.3 mentions" than "design a transfer flow," since no in-app path
reaches this state.

- **`OrganizationWebhookConfig`** (schema line ~304) and **`WhatsAppNumberMapping`** (line
  ~348) both key **only** on `organizationId` — neither has any field referencing a specific
  `User` at all. Confirmed directly: n8n webhook URLs and the WhatsApp number mapping are
  org-level configuration with no ownership concept baked in. If every OWNER of an org were
  somehow gone (only reachable via direct DB manipulation, per §2.3), this configuration would
  sit untouched and fully functional — there's nothing to "transfer," since it was never
  attached to a person.
- **`Invite.invitedById`** (schema line ~329) — nullable, `onDelete: Cascade` to `User`.
  This is the one place a `User` row deletion (not the field-clearing removal §2 specifies)
  would cause real, cross-cutting damage: deleting a `User` row cascades to delete every
  `Invite` they ever sent, including pending invites still awaiting acceptance by *other*
  people, orphaning those recipients' invite links. This is a second, independent confirmation
  (alongside §4's ticket/activity finding) of why §2's removal mechanism must never delete the
  `User` row — reinforcing, not just restating, since this is a different downstream table with
  the same root hazard.
- **Practical conclusion**: since (a) org-level config has no user-ownership concept to
  transfer, and (b) §2.3 already prevents an OWNER from being removed or leaving via any
  in-app action, **there is no "ownerless org" state reachable through this design as
  specified.** The only way to reach it is the same direct-DB break-glass path
  `MULTI_TENANCY_DESIGN.md §9.6` already flagged as out of scope — and even then, per the two
  points above, the org's webhook/WhatsApp config would survive intact; only pending invites
  sent *by* that specific removed-via-DB user would be lost, which is a narrow, already-flagged,
  break-glass-only consequence, not a design gap in the in-app feature this document specifies.

---

## Summary Checklist (for implementation planning, not for now)

- [ ] Add a per-page staleness check (§1.3) comparing the DB's current `User.organizationId`
      against the token's, forcing re-authentication on mismatch. Likely factored into a shared
      helper to avoid duplicating it across every protected page (§1.4 open decision).
- [ ] `removeMemberAction` (§2.1) — OWNER-gated, cross-org-tamper-checked, refuses `OWNER`
      targets, clears `organizationId`/`role` via `update`, never `delete`.
- [ ] `leaveOrganizationAction` (§2.2) — MEMBER-only (blocks OWNER per §2.3), same field-clearing
      mechanism.
- [ ] Fix the `jwt` callback gap not by changing `jwt` itself, but by adding
      `getPendingInvitesForUser` (§3.2) and a UI surface for it, plus a new explicit
      leave-then-join confirmation step extending `/accept-invite`'s existing branching (§3.3).
- [ ] No schema changes required for §4/§5's findings — both already hold structurally; only
      the *implementation discipline* of "update, never delete" (§2, §4, §5) needs to be
      followed and is worth a code comment at the call site referencing this document.
