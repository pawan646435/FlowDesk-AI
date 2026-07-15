# Join Request Flow — Design

Adds a second path for a new user to join an organization, alongside the existing
owner-initiated invite flow (`MULTI_TENANCY_DESIGN.md` §9, `ORG_ONBOARDING_DESIGN.md` §1). A
first-time Google sign-in with no invite currently gets rejected outright at the `signIn`
callback (`MULTI_TENANCY_DESIGN.md` §9.4). This document designs loosening that gate so such a
user instead lands authenticated-but-orgless, and can request access to a specific org by
entering its owner's email; the owner approves or rejects from `/settings`.

**This explicitly supersedes part of `MULTI_TENANCY_DESIGN.md` §9.4** — stated plainly here,
not left ambiguous: §9.4's original reasoning ("reject at sign-in... no `User` row is created")
is being replaced for the *specific* case of "no invite, no existing account." §9.4's *other*
reasoning — never letting a signed-in browser attempt a second OAuth sign-in, to avoid Auth.js's
account-linking behavior — is untouched and still fully in force (§2 below confirms this
explicitly, not just by assertion).

No implementation code below — design only, per the brief.

---

## 1. Confirming actual current behavior — investigated, not assumed

Traced directly against the running code rather than reasoning abstractly, because this
question turned out to have a much larger answer than "is orgless-but-authenticated reachable."

### 1.1 Is this state reachable today?

**No.** `src/auth.ts`'s `signIn` callback:

```ts
async signIn({ user, profile }) {
  const email = profile?.email ?? user?.email;
  if (!email) return false;
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return true;
  const validInvite = await prisma.invite.findFirst({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  return !!validInvite;
}
```

For a first-time Google account with no matching `Invite`, this returns `false` before
`PrismaAdapter.createUser` ever runs — confirmed in `MULTI_TENANCY_DESIGN.md` §9.4's own traced
source (`createUser` happens after `signIn` succeeds, never before). No `User` row is created,
so the orgless-authenticated state cannot exist today for a first-time sign-in.

### 1.2 What happens to an orgless-but-somehow-authenticated user today, if one existed?

This is the finding that matters most for this design's shape, and it's larger than the
brief's framing suggested. Every protected page in this app resolves its session via
`src/lib/session.ts`'s `getVerifiedSession()`:

```ts
if (!session?.user?.id || !session.user.organizationId) {
  if (options.onStale === "unauthorized") return null;
  redirect("/login");
}
```

**This helper treats "no `organizationId`" as identical to "no session at all."** It doesn't
distinguish "you're not logged in" from "you're logged in but have no org." Tracing this through
every consumer:

- `/dashboard`, `/tickets`, `/tickets/queue`, `/tickets/[id]`, `/settings` — all call
  `getVerifiedSession()` with the default `{ onStale: "redirect" }`, so an orgless-but-real
  session gets bounced straight to `/login`, indistinguishable from not being signed in.
- `src/app/layout.tsx` (the root layout, wraps every page) calls
  `getVerifiedSession({ onStale: "unauthorized" })` and passes the result to `Navbar` — so the
  navbar itself would render as fully signed-out (`if (!session) return null;` in `navbar.tsx`)
  for an orgless user, even though they have a real, valid session cookie.
- `/login` itself calls the same helper — so an orgless-but-authenticated user landing on
  `/login` would see `session` as `null` and be shown the "Continue with Google" button, as if
  they'd never signed in. Clicking it would go through Google's OAuth flow again,
  re-triggering `signIn`, which (per §1.1, with `existingUser` now truthy) returns `true`
  immediately — landing them right back in the same orgless state, an unproductive loop if
  nothing else changes.
- `middleware.ts` is the *one* place that would actually let such a user through:
  `isLoggedIn = !!req.auth` only checks JWT presence, not `organizationId` — so middleware
  itself wouldn't block navigation to `/dashboard`. But the page they land on would then bounce
  them via `getVerifiedSession()` regardless, so this doesn't change the practical outcome.

**Conclusion**: loosening the `signIn` gate alone is not sufficient to reach this design's goal.
`getVerifiedSession()` must be taught to distinguish "no session" from "session, no org" —
otherwise an orgless user would be authenticated in the database and cookie sense, but the
entire application surface would treat them as logged out, with no path to ever reach the new
landing page this design proposes in §3. This is a real, load-bearing prerequisite, not a
minor detail — flagging it here so it isn't discovered mid-implementation.

---

## 2. Loosening the signIn gate — the security-sensitive part

### 2.1 What changes, precisely

`signIn`'s current three-way logic (`existingUser` → allow; `validInvite` → allow; neither →
reject) becomes two-way: **allow through unconditionally**, letting `PrismaAdapter.createUser`
proceed for any authenticated Google account with a valid email. The `Invite` check moves
downstream — it still matters (an invited user should land pre-assigned to their org, not
orgless), but it no longer gates *whether* sign-in succeeds, only *what state* the resulting
user starts in.

```ts
async signIn({ user, profile }) {
  const email = profile?.email ?? user?.email;
  if (!email) return false; // still reject: no email means nothing downstream can work
  return true; // no more existingUser/validInvite branching — always allow through
}
```

The `jwt` callback's existing invite-lookup branch (§9.3, already handles "brand-new user,
check for a pending Invite") is untouched — it still runs exactly as before for a user with no
`organizationId`. If an `Invite` exists, they're assigned as before. If none exists (the new
case this design adds), `token.organizationId`/`role` stay `null` — which the `jwt` callback's
existing `else` branch (§9.4's original code, the "should be unreachable" comment) already
produces correctly; that comment is simply no longer accurate once this ships, since the state
becomes reachable by design. Update that comment, don't change the code path — the existing
"consistent shape, string|null, never undefined" logic already does exactly the right thing.

### 2.2 Is `email` presence still worth checking?

Yes, kept as-is (`if (!email) return false`) — this isn't part of what's being loosened. An
OAuth response with no email is a malformed/misconfigured provider response, not a legitimate
"first-time user" case; nothing downstream (the `User.email` unique constraint, the `Invite`
lookup by email, this design's own owner-email-resolution in §5) can function without one.
Rejecting it isn't gatekeeping org access, it's guarding against a broken auth response.

### 2.3 Does any other rejection case still make sense?

No new one is being added. The brief asks explicitly whether `AccessDenied` should be "reserved
for some other case" — after reviewing every existing use of the rejection path, there isn't
one to reserve it for. The account-linking-fix pages (`/login`, `/accept-invite`) never trigger
`AccessDenied` via `signIn` returning `false` — they prevent the *attempt* from starting in the
first place (§2.4 confirms this precisely). So with this change, `signIn` effectively never
returns `false` for a real Google account with an email — the `AccessDenied` error page/copy
(`login/page.tsx`'s `error === "AccessDenied"` branch) becomes dead code for the *deny-by-default*
scenario specifically. Not proposing to delete that branch — see open decision in §2.6.

### 2.4 Confirming this does not reopen the account-linking security issue

Traced this precisely rather than asserting it. The account-linking bug (fixed earlier this
project) was: Auth.js's OAuth handling (`@auth/core`, inside `handleLoginOrRegister`) links a
*new* Google account to whichever `User` is *currently signed in on the request* — this happens
entirely inside `@auth/core`, before this app's `signIn`/`jwt` callbacks ever run, and is
therefore **impossible to intercept from within `signIn` itself, loosened or not**. The actual
fix was and remains: never render a "Continue with Google" button while any session already
exists (`login/page.tsx`, `accept-invite/page.tsx` both gate on `existingSession?.user?.id`
before offering that button at all, using `getVerifiedSession`).

This design's changes to `signIn`'s *return value logic* have zero interaction with that
mechanism — the account-linking bug was never about what `signIn` returns, it was about
`@auth/core`'s pre-callback linking behavior triggering on a second OAuth *attempt* while
already signed in. As long as the new orgless-landing page (§3) doesn't introduce a fresh
"Continue with Google" button reachable while a session exists — and it doesn't need to, since
an orgless user by definition already has *a* session, they're never asked to sign in again to
submit a join request — this fix's discipline is preserved untouched. Confirming explicitly:
**§3's landing page never renders an OAuth sign-in form.** It only ever renders the join-request
form/status view, which are plain authenticated Server Actions, not new OAuth entry points.

### 2.5 What this changes relative to §9.4's original threat model

§9.4 framed the risk as: an unauthorized Google account could otherwise probe/access the app
with no invite. Loosening `signIn` means that risk moves from "prevented at sign-in" to
"prevented at the org boundary" — an orgless user *can* now authenticate, but per §1.2's fix
(distinguishing "no session" from "session, no org" in `getVerifiedSession`), they still cannot
reach `/dashboard`, `/tickets`, `/settings`'s org-scoped content, or any org-scoped data at all;
they can only reach the new orgless-landing page (§3) and the join-request mechanism itself. No
`Ticket`/`Activity`/`KnowledgeDocument`/`WhatsApp*` data is reachable without `organizationId`
being set, and none of the existing per-org scoping (`MULTI_TENANCY_DESIGN.md` §3) changes.
The actual attack surface added is: anyone with a Google account can now have a `User` row
exist in this database (previously, only invited people could). That's a meaningfully different
but bounded exposure — worth stating plainly rather than glossing over — and it's exactly the
tradeoff inherent to "let people request access" as a feature; it can't be added without some
version of this.

### 2.6 Open decisions — §2

1. **Should the `AccessDenied` error page/copy be removed** now that `signIn` no longer
   produces it via the deny-by-default path? Leaning toward keeping it as dead-but-harmless
   code for now (the `error` query-param handling costs nothing to leave in place, and Auth.js
   could still theoretically surface other error codes there) rather than deleting working
   error-handling UI as part of this change — but flagging that its docstring/comment claiming
   "This Google account isn't associated with any FlowDesk organization" would become stale copy
   describing a scenario that can no longer occur.
2. **Rate limiting/abuse on account creation itself** — with `signIn` no longer gating on
   invite presence, anyone can create a `User` row by signing in with Google. This is a
   different, adjacent concern from §9's join-request spam question (§9 below) — this is about
   unbounded orgless-`User`-row creation, not repeated requests to one org. Not designed here;
   flagging that Google's own OAuth flow (requiring a real Google account, consent screen, etc.)
   is already a meaningful friction floor, and this app has no self-serve email/password signup
   to make bot creation trivial — treating this as low-risk at current scale, but noting it.

---

## 3. The "no org" landing experience

### 3.1 The prerequisite fix, precisely scoped

Per §1.2's finding, `getVerifiedSession()` needs a variant (or a parameter) that permits
"authenticated, no org" through without redirecting, so the new landing page can actually be
reached. Proposing a minimal, additive change — not a rewrite of the existing helper, since
every other call site's behavior (redirect-if-no-org) is correct and load-bearing for org-scoped
pages and must not change:

```ts
// New option, additive to the existing onStale-based overloads — doesn't touch their behavior.
export async function getVerifiedSession(
  options: { onStale: "redirect" | "unauthorized"; requireOrg?: boolean } = { onStale: "redirect", requireOrg: true }
)
```

`requireOrg: false` skips the `!session.user.organizationId` branch's redirect, returning a
session whose `organizationId` may be `null` — used only by the new orgless-landing page itself
and by `layout.tsx`/`login/page.tsx` (both of which need to recognize "authenticated, no org" as
a distinct, valid state now, per §1.2). Every existing call site (`/dashboard`, `/tickets`,
`/settings`, etc.) keeps its current default (`requireOrg: true`, unchanged), so none of the
org-scoping guarantees `MULTI_TENANCY_DESIGN.md` §3 already established are weakened.

### 3.2 The page itself

New route, `/onboarding` (not `/dashboard` — an orgless user has nothing dashboard-shaped to
see, and reusing `/dashboard`'s route with a conditional orgless branch would tangle two very
different pages' concerns together). `middleware.ts`'s existing `isDashboard`/`isTickets`/
`isSettings` protected-route list doesn't need `/onboarding` added — it's reachable by anyone
authenticated (checked via `requireOrg: false`), not gated behind org membership, so it sits
outside that list by design, alongside `/login`/`/create-organization`/`/accept-invite`.

Server Component, using `getVerifiedSession({ onStale: "redirect", requireOrg: false })` —
still redirects to `/login` if genuinely unauthenticated, just no longer redirects for the
no-org case. If `session.user.organizationId` is *actually* set (e.g. someone bookmarks this
page after joining an org), redirect to `/dashboard` — this page has nothing to show a
genuinely org'd user.

Two states, matching the brief's "form plus a status view" instruction:

- **No pending `JoinRequest` exists for this user**: show the request form — a single email
  input ("Enter your team owner's email") plus submit. Copy explains what happens next ("your
  org's owner will need to approve this request").
- **A pending `JoinRequest` exists**: show a status card instead of the form — "Your request to
  join `<Org Name>` is pending approval," with a "Cancel request" action (§4 designs whether
  cancellation is in scope) rather than letting them spam a second request to the same org
  while one is already outstanding.

Also link to `/create-organization` from this page ("Starting a new company instead?") — this
design adds a second path *into* an existing org, it doesn't replace the self-invite
org-creation path `ORG_ONBOARDING_DESIGN.md` §1 already built; both remain valid, equally
legitimate routes for a first-time visitor, consistent with that doc's landing-page reasoning
(§3 there: multiple equally-first-class entry points, not one primary/one secondary).

### 3.3 Open decisions — §3

1. **Exact route name** (`/onboarding` proposed) — no strong reason it couldn't be
   `/join-request` or similar; picked `/onboarding` since it reads naturally as "you're
   authenticated but not set up yet," but this is a minor naming call.
2. **What does `/login`'s post-sign-in redirect target become?** Today `signIn("google", {
   redirectTo: "/dashboard" })` is hardcoded in both `login/page.tsx` and
   `accept-invite/page.tsx`. For a first-time orgless sign-in, landing on `/dashboard` would
   immediately bounce (via the *existing*, unchanged `requireOrg: true` default) back toward
   `/onboarding` or `/login` depending on how that redirect is written — worth deciding whether
   to special-case the post-sign-in redirect target, or simply let `/dashboard`'s own
   `getVerifiedSession()` call redirect an orgless user to `/onboarding` instead of `/login` (a
   one-line change to that redirect target, distinguishing "not authenticated" → `/login` from
   "authenticated, no org" → `/onboarding`). Leaning toward the latter — it's a smaller,
   centralized change — but not deciding the exact mechanics here.

---

## 4. `JoinRequest` data model

```prisma
enum JoinRequestStatus {
  PENDING
  APPROVED
  REJECTED
}

model JoinRequest {
  id                String            @id @default(cuid())
  requesterId       String
  organizationId    String
  status            JoinRequestStatus @default(PENDING)
  requestedOwnerEmail String          // what the requester actually typed — kept even though
                                       // it resolves to organizationId, for the owner-side UI
                                       // to show "requested via <email>" and for audit/debugging
  createdAt         DateTime          @default(now())
  resolvedAt         DateTime?
  resolvedById       String?          // the OWNER who approved/rejected; null while PENDING

  requester    User          @relation("JoinRequestsMade", fields: [requesterId], references: [id], onDelete: Cascade)
  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  resolvedBy   User?         @relation("JoinRequestsResolved", fields: [resolvedById], references: [id], onDelete: SetNull)

  @@unique([requesterId, organizationId, status])
  @@index([organizationId, status])
  @@index([requesterId])
}
```

**Two relations to `User`** (`requester`, `resolvedBy`) need distinct relation names in Prisma
(`@relation("JoinRequestsMade")` / `@relation("JoinRequestsResolved")`) since both point at the
same model — same pattern would be needed anywhere a model has two FKs into the same table;
this schema doesn't have a precedent for it yet, but it's a standard, well-understood Prisma
pattern, not a novel risk.

**`resolvedBy` uses `onDelete: SetNull`, not `Cascade`** — deliberately different from
`Invite.invitedBy`'s existing `onDelete: Cascade`. Reasoning: `TEAM_REMOVAL_DESIGN.md` §4/§5
already established that a `User` row is never actually deleted by this app (removal/leaving is
always an `update`, never a `delete`) — so in practice this FK's `onDelete` behavior is
close to moot for in-app flows. But if it's ever hit via the break-glass DB-manipulation path
those docs already flag as out of scope, `SetNull` preserves the resolved `JoinRequest`'s
history (who requested what, whether it was approved) rather than cascading it away — a
`JoinRequest` is a decision record, arguably worth keeping even if the approver's row is later
gone via an out-of-band operation. `requester`/`organization` keep `Cascade`, matching
`Invite`'s existing precedent — a request tied to a deleted org (via a genuinely destructive
org-deletion, itself out of scope per `MULTI_TENANCY_DESIGN.md` §8) shouldn't dangle either.

### 4.1 Uniqueness — designed against both spam scenarios the brief named

- **Same org, repeatedly**: `@@unique([requesterId, organizationId, status])` — a requester
  cannot have two `PENDING` requests to the same org simultaneously (the unique constraint
  would reject the second `INSERT`). Once a request resolves to `APPROVED`/`REJECTED`, the
  triple `(requesterId, organizationId, status)` changes, so a *new* `PENDING` row for the same
  org+requester becomes insertable again — meaning a rejected requester **can** try again later
  (deliberately not blocked permanently — see §9's abuse-handling call, which addresses the
  *rate* of resubmission, not whether it's ever allowed at all).
- **Multiple orgs simultaneously**: **not blocked at the schema level**, and this is a
  deliberate design call, not an oversight — see §8 below, which reuses
  `TEAM_REMOVAL_DESIGN.md`'s existing one-org-per-user reasoning to resolve this the same way
  invites already do (multiple *pending requests* to different orgs can coexist; only
  *membership* is exclusive, enforced at approval time, not at request time).

---

## 5. Owner-email-to-org resolution — enumerated error cases

The requester types an email; the server must resolve it to exactly one `(Organization,
inviting-OWNER)` pair or explain why it can't. Every case, walked through:

| Input | Resolution |
|---|---|
| Email doesn't match any `User` row | Reject with a clear message: "No FlowDesk account found for that email. Ask your team owner to sign in first, or check the address." Doesn't leak whether the email exists as a *non-owner* `User` — see next row for why that's handled the same way, not because of an information-disclosure concern (this isn't sensitive data in this app's threat model), but because the actual answer ("that person can't approve you") is the same regardless. |
| Email matches a `User`, but `role !== "OWNER"` (i.e., it's a MEMBER, or an orgless user) | Reject: "That person isn't an organization owner and can't approve join requests. Ask your actual org owner for their email, or check with them for an invite instead." |
| Email matches an `OWNER`, and the requester **already has a `PENDING` request to that exact org** | Reject at the form level before ever writing a row — the `@@unique` constraint would catch this as a DB error, but surfacing it as a clean validation message ("You already have a pending request to `<Org>`") is better UX than a raw constraint violation. Requires reading the requester's existing `JoinRequest`s before insert, which the Server Action already needs to do for §3.2's landing-page display anyway. |
| Email matches an `OWNER` of the org the requester **is currently already a member of** | Reject: "You're already a member of this organization." Trivial check — `session.user.organizationId === resolvedOrg.id`. |
| Email matches an `OWNER`, the org is different from the requester's current one (if any), no existing `PENDING` request — the normal case | Create the `JoinRequest`, `PENDING`, targeting that org. |
| The org has **multiple** `OWNER`s (not reachable today per `TEAM_REMOVAL_DESIGN.md` §2.3's one-OWNER-per-org invariant, but the email-to-user lookup is still just "does this email belong to *an* OWNER of *some* org" — inherently singular given today's invariant) | Not a real case given the current invariant; noting only so a future relaxation of "exactly one OWNER" would need to revisit this resolution step, not silently assume it still holds. |

All of these are validation-time checks in the Server Action (§7), not schema constraints
(aside from the `PENDING`-duplicate case, which the schema also backstops) — matching the
existing pattern `sendInviteAction`/`removeMemberAction` already use for their own multi-step
validation.

---

## 6. Owner-side approve/reject UI

New section on `/settings`, OWNER-gated, same pattern as the existing "Invite a teammate" and
"n8n webhook settings" sections (`isOwner ? <RealContent /> : <p>Only owners can...</p>`).
Placed near the existing "Pending Invites" section (`TEAM_REMOVAL_DESIGN.md` §3.2) since both
are "things awaiting this org's attention" — but this is a **distinct** list: "Pending Invites"
(existing) shows invites *the viewer received* to other orgs; this new "Join Requests" section
shows requests *other people sent to the viewer's org*. Different direction, different audience
(the existing one is relevant to any viewer regardless of role; this one is OWNER-only), worth
keeping visually separate rather than merging into one list.

Each pending request row: requester's name/email (join `requester` relation), requested date,
Approve/Reject buttons — matching `RemoveMemberButton`'s existing `useTransition` + `confirm()`
client-component pattern (`TEAM_REMOVAL_DESIGN.md` §2.4/§2.5) rather than inventing a new
interaction shape. Reject doesn't need a confirmation per §2.5's precedent (that was for a
destructive-to-someone-else's-access action; rejecting a request that was never approved has no
comparable stakes) — Approve arguably deserves a lighter one ("Approve `<name>` to join as
MEMBER?") since it does have a real access-granting consequence, but this is a UX-polish
decision, not a security-relevant one either way — see open decision below.

### 6.1 Open decisions — §6

1. **Confirmation on Approve specifically** — proposed as optional/lighter than the
   remove-member `confirm()`, but not firmly decided; either choice is defensible.
2. **Does REJECTED need to be user-visible with a reason?** Not designing a
   rejection-reason field here — keeping the model minimal per the brief's own instruction not
   to over-collect. A rejected requester sees their request disappear from "pending" on
   `/onboarding` (§3.2); whether they see a distinct "rejected" state with a reason, or the form
   just becomes available again silently, is a small UX call not resolved here.

---

## 7. Approval mechanics and session propagation

### 7.1 The Server Action

`approveJoinRequestAction(requestId: string)` in a new `src/app/settings/join-request-actions.ts`
(matching the existing `team-actions.ts`/`webhook-actions.ts` per-concern file split):

```ts
export async function approveJoinRequestAction(requestId: string) {
  const session = await getVerifiedSession({ onStale: "unauthorized" });
  if (!session) return { error: "Unauthorized" };
  if (session.user.role !== "OWNER") return { error: "Only organization owners can approve join requests." };

  const request = await prisma.joinRequest.findUnique({ where: { id: requestId } });
  if (!request || request.organizationId !== session.user.organizationId || request.status !== "PENDING") {
    return { error: "Request not found." }; // same cross-org-tamper discipline as removeMemberAction
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: request.requesterId },
      data: { organizationId: request.organizationId, role: "MEMBER" }, // always MEMBER — never OWNER, see §2.5/§2.3 cross-reference below
    }),
    prisma.joinRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", resolvedAt: new Date(), resolvedById: session.user.id },
    }),
  ]);

  revalidatePath("/settings");
  return { success: true };
}
```

**Always assigns `role: "MEMBER"`, never a role from the request itself** (there is no role
field on `JoinRequest` to begin with — a requester doesn't get to ask for OWNER; the schema in
§4 has no such field, deliberately). This directly preserves `TEAM_REMOVAL_DESIGN.md` §2.3's
one-OWNER-per-org invariant — the same reasoning that document used to block
`removeMemberAction`/`leaveOrganizationAction` from ever touching an OWNER applies symmetrically
here: this design must never be the mechanism that creates a *second* OWNER either. Confirmed
this is airtight by construction, not by convention — there's no field to set to `OWNER` even if
someone wanted to.

**The cross-org-tamper check** (`request.organizationId !== session.user.organizationId`)
mirrors `removeMemberAction`'s exact discipline (`TEAM_REMOVAL_DESIGN.md` §2.1) — an OWNER must
not be able to approve/reject a request belonging to a different org by guessing/tampering with
a request id.

`rejectJoinRequestAction(requestId: string)` — same auth/tamper checks, simpler body: just
`prisma.joinRequest.update({ data: { status: "REJECTED", resolvedAt, resolvedById } })`, no
transaction needed since it doesn't touch `User`.

### 7.2 Session propagation — reusing, not reinventing

The brief's instruction to confirm this reuses `TEAM_REMOVAL_DESIGN.md` §1 rather than designing
new propagation is correct, and confirmed directly: `getVerifiedSession()`'s existing staleness
check (compare the DB's current `organizationId`/`role` against the token's, redirect/return
null on mismatch) requires **zero changes** to support this. The requester's token, issued at
their original (orgless) sign-in, has `organizationId: null`. Once `approveJoinRequestAction`
updates their `User` row to a real `organizationId`, their *next* page load or Server Action
call — anywhere in the app, no special-casing needed — hits the existing staleness comparison,
finds `DB organizationId (real) !== token organizationId (null)`, and forces exactly the same
re-authentication flow already built for the removal/leave case. This is precisely the "next
page load or re-authentication" propagation the brief asked to confirm, and it already works
today for the structurally identical case (a user's org membership changing between one request
and the next) — nothing new to build here at all.

---

## 8. Interaction with the one-org-per-user invariant

The brief asks whether an already-org'd requester can send a join request to a different org,
and instructs reusing `TEAM_REMOVAL_DESIGN.md`'s leave-then-join reasoning rather than
re-deriving it. Doing exactly that:

**Requesting**: yes, allowed — per §4.1, the schema doesn't block a requester from having
`PENDING` requests to multiple different orgs (only duplicate requests to the *same* org are
blocked). This mirrors `TEAM_REMOVAL_DESIGN.md` §3's existing "Pending Invites" design, where an
already-org'd user can have invites to other orgs sitting visible on `/settings` without it
implying anything about their current membership — a *request* or *invite* existing is not the
same as *membership*, and only membership is exclusive.

**Approving, when the requester already belongs to a different org**: this is where the actual
one-org-per-user enforcement has to happen, and it should happen **the same way**
`TEAM_REMOVAL_DESIGN.md` §3.3 already solved it for invites — not silently switching, not a
separate new confirmation flow invented for this case. Concretely: `approveJoinRequestAction`
(§7.1 above) as written **already handles this correctly by construction**, because it does a
plain `prisma.user.update({ data: { organizationId: request.organizationId, role: "MEMBER" } })`
— this single `update` statement inherently *replaces* whatever `organizationId` the row
previously had, which is exactly "leave the old org, join the new one" in one write. There's no
separate "leave" step needed on the *approval* side, because updating one field to a new value
already discards the old value — this is different from §3.3's invite-acceptance case only in
*where* the explicit-confirmation UX lives: for invites, the *user* clicks a confirming button
on `/accept-invite` because *they* are the one initiating the switch mid-session. For join
requests, the *requester* already explicitly initiated this by choosing to submit a request to a
new org's owner in the first place (§3.2's form) — that submission **is** their explicit
consent to switch, so no additional confirmation step is needed at approval time. The OWNER
approving isn't the party who needs to consent to the requester leaving their old org; the
requester already consented by requesting.

**Worth surfacing to the requester anyway, for clarity, not as a gate**: if `/onboarding` (§3.2)
detects the requester already has an org at the time they're filling out the form (a case that
can arise if e.g. they got approved into org A right after submitting a request to org B, before
checking back), the form's copy should say so plainly ("You're currently a member of `<Org
A>`. Submitting this request means you'll leave `<Org A>` if `<Org B>`'s owner approves it.") —
informational, not blocking, since blocking it would just push the same decision to a worse
place (the requester canceling and re-requesting later, achieving nothing).

---

## 9. Abuse/spam considerations — a call, not just a flag

The brief asks for a decision here, not another open item. Making one:

**No cooldown timer, no rate limiting beyond the existing `@@unique([requesterId,
organizationId, status])` duplicate-pending-request block.** Reasoning: this app has no
self-serve email/password signup and no API surface reachable without a real Google OAuth
sign-in (§2.6 already noted this as the meaningful friction floor for account creation itself).
A join request additionally requires knowing a real org owner's actual email address — not
guessable/enumerable through this flow (§5's error messages don't distinguish "no such email"
from "not an owner," so there's no oracle for probing which emails belong to owners at all). The
realistic abuse case — someone spamming *rejected* requests to the same real, known owner
repeatedly — is already meaningfully throttled by the human-approval step itself: an owner who
rejects a request once will see (and can reject) another from the same person; there's no
automated amplification, and the cost of building/maintaining a cooldown mechanism (tracking
attempt timestamps, deciding a window, surfacing "try again in N hours" UX) is disproportionate
to a threat that's already bounded by "a human has to look at it and click reject each time,"
at this project's current scale. If this ever needs revisiting, the trigger would be evidence of
actual abuse, not speculative hardening now.

---

## Summary Checklist (for implementation planning, not for now)

- [ ] Loosen `signIn` in `src/auth.ts` per §2.1 — remove the `existingUser`/`validInvite`
      branching, keep only the `!email` check. Update the stale "should be unreachable" comment
      in the `jwt` callback's else-branch (§2.1) — code unchanged, comment no longer accurate.
- [ ] Extend `getVerifiedSession()` with `requireOrg?: boolean` per §3.1 — additive, every
      existing call site's default behavior (redirect-if-no-org) is unchanged.
- [ ] New `/onboarding` page (§3.2) — request form / pending-status view, using
      `requireOrg: false`. Decide the exact post-sign-in redirect target for a first-time
      orgless user (§3.3 open decision #2).
- [ ] New `JoinRequest` model + `JoinRequestStatus` enum (§4) — two named relations to `User`,
      `resolvedBy` uses `SetNull` (deliberately different from `Invite.invitedBy`'s `Cascade`).
- [ ] Owner-email-resolution logic (§5) as Server Action validation, not schema constraints
      (aside from the duplicate-pending-request case).
- [ ] New "Join Requests" section on `/settings`, OWNER-gated, visually distinct from the
      existing "Pending Invites" section (§6) — different direction, different audience.
- [ ] `approveJoinRequestAction`/`rejectJoinRequestAction` in a new
      `src/app/settings/join-request-actions.ts` (§7.1) — approval always assigns `role:
      "MEMBER"`, never reads a role from the request (no such field exists). No new session-
      propagation mechanism — `getVerifiedSession()`'s existing staleness check already covers
      this case by construction (§7.2).
- [ ] No cooldown/rate-limiting beyond the existing uniqueness constraint (§9, decided).
