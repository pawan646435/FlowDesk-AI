import prisma from "@/lib/prisma";
import crypto from "crypto";
import { OrganizationRole, CompanyIndustry, CompanySize, TicketStatus } from "@prisma/client";

const INVITE_EXPIRY_DAYS = 7; // MULTI_TENANCY_DESIGN.md §9.2

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// ORG_ONBOARDING_DESIGN.md §1.4 — the shared row-creation primitive both
// createOrganizationWithSelfInviteAndTeam (invitedById: null, no User row exists yet at
// org-creation time) and createTeamInvite (invitedById: a real User, the /settings case)
// build on. Not a replacement for createTeamInvite's public signature/behavior — that
// function keeps taking a required invitedById, since callers from /settings always have
// a signed-in User to attribute the invite to.
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueSlug(base: string): Promise<string> {
  const baseSlug = slugify(base) || "org";
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
  return slug;
}

export interface OrganizationCompanyDetails {
  industry: CompanyIndustry;
  size: CompanySize;
  website?: string;
}

/**
 * ORG_ONBOARDING_DESIGN.md §1.4 — self-invitation org creation with company details and
 * an optional batch of teammate invites, all created in the same submission. Creates the
 * Organization, an Invite targeting the creator's own email with role OWNER (unchanged
 * from MULTI_TENANCY_DESIGN.md §9.1's createOrganizationWithSelfInvite, which this
 * supersedes), and one MEMBER Invite per teammate email. No User row is created for
 * anyone here; every invite is consumed identically via the existing §9.3 sign-in path —
 * this function only creates rows, it doesn't touch consumption at all.
 */
export async function createOrganizationWithSelfInviteAndTeam(
  orgName: string,
  creatorEmail: string,
  companyDetails: OrganizationCompanyDetails,
  teammateEmails: string[]
) {
  const slug = await uniqueSlug(orgName);

  const organization = await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      industry: companyDetails.industry,
      size: companyDetails.size,
      website: companyDetails.website?.trim() || null,
    },
  });

  // invitedById is left null — no User row exists yet at self-invite time (schema
  // change: Invite.invitedById is nullable specifically for this case, see schema.prisma).
  const ownerInvite = await createInviteRow(organization.id, creatorEmail, OrganizationRole.OWNER, null);

  // Dedupe defensively — the client already prevents duplicate rows in the UI, but a
  // duplicate submission (double-click, retried request) shouldn't create two Invite rows
  // for the same email; @@unique([organizationId, email]) would reject the second one
  // anyway, but going through createInviteRow's upsert makes that a no-op refresh instead
  // of a thrown constraint error. Also drop the creator's own email if they typed it into
  // the teammate list too — they already have the OWNER invite above.
  const uniqueTeammateEmails = [...new Set(teammateEmails.filter((e) => e !== creatorEmail))];
  const teamInvites = await Promise.all(
    uniqueTeammateEmails.map((email) => createInviteRow(organization.id, email, OrganizationRole.MEMBER, null))
  );

  return { organization, ownerInvite, teamInvites };
}

/**
 * MULTI_TENANCY_DESIGN.md §9.6 — invite a teammate. Refreshes (rather than duplicates)
 * a pending invite for the same org+email per §9.2's @@unique([organizationId, email]).
 */
export async function createTeamInvite(organizationId: string, invitedById: string, email: string) {
  return createInviteRow(organizationId, email, OrganizationRole.MEMBER, invitedById);
}

export async function getInviteByToken(token: string) {
  return prisma.invite.findUnique({
    where: { token },
    include: { organization: true },
  });
}

/**
 * TEAM_REMOVAL_DESIGN.md §3.2 — surfaces pending invites for an already-onboarded user.
 * Deliberately independent of User.organizationId entirely: the jwt callback's invite
 * lookup is unreachable once a user already has an org (see §3.1's confirmed bug), so
 * this is a separate, additive read used purely for UI visibility — it never assigns
 * an org itself. Works identically whether the viewer currently has an org or not.
 */
export async function getPendingInvitesForUser(email: string) {
  return prisma.invite.findMany({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
    include: { organization: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * TEAM_REMOVAL_DESIGN.md §3.3 — the explicit leave-then-join action, used when an
 * already-org'd user accepts an invite to a *different* org. Both the leave
 * (organizationId: null) and the join (organizationId: invite.organizationId,
 * role: invite.role, Invite.acceptedAt) happen in one $transaction so there's no moment
 * where the user is orgless if anything fails partway — matching the transactional
 * pattern auth.ts's jwt callback already uses for the ordinary (first-time) join case.
 */
export async function leaveAndJoinOrganization(userId: string, inviteId: string) {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new Error("This invite is no longer valid.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { organizationId: invite.organizationId, role: invite.role },
    }),
    prisma.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);
}

export async function getOrganizationMembers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

// ORG_ONBOARDING_DESIGN.md §2.3 — OWNER dashboard's Team Overview widget. Reuses
// getOrganizationMembers's query plus one additional groupBy for each member's open
// (non-resolved) ticket count. Two queries rather than one combined query since Prisma
// can't easily express "each user, plus a count of their non-resolved tickets" as a
// single findMany with an aggregated relation count filtered by status.
export async function getOrganizationMembersWithOpenTicketCount(organizationId: string) {
  const [members, openCounts] = await Promise.all([
    getOrganizationMembers(organizationId),
    prisma.ticket.groupBy({
      by: ["userId"],
      where: { organizationId, status: { not: TicketStatus.RESOLVED } },
      _count: { id: true },
    }),
  ]);

  const countByUserId = new Map(openCounts.map((c) => [c.userId, c._count.id]));

  return members.map((member) => ({
    ...member,
    openTicketCount: countByUserId.get(member.id) ?? 0,
  }));
}

// ORG_ONBOARDING_DESIGN.md §1.6 open decision, resolved — read-only Org Profile section
// on /settings so industry/size/website aren't write-only.
export async function getOrganizationProfile(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, industry: true, size: true, website: true },
  });
}

// MULTI_TENANCY_DESIGN.md §7 — per-org n8n webhook URLs, settings-page CRUD.
export interface WebhookConfigInput {
  newTicketUrl: string;
  escalationUrl: string;
  negativeSentimentUrl: string;
  resolutionUrl: string;
  slaBreachUrl: string;
}

export async function getOrganizationWebhookConfig(organizationId: string) {
  return prisma.organizationWebhookConfig.findUnique({ where: { organizationId } });
}

export async function upsertOrganizationWebhookConfig(organizationId: string, data: WebhookConfigInput) {
  // Empty strings mean "not configured" from the settings form's point of view — store
  // as null so triggerWebhook's existing unconfigured-skip guard (n8n.service.ts) applies,
  // rather than attempting a fetch to an empty-string URL.
  const normalized = {
    newTicketUrl: data.newTicketUrl.trim() || null,
    escalationUrl: data.escalationUrl.trim() || null,
    negativeSentimentUrl: data.negativeSentimentUrl.trim() || null,
    resolutionUrl: data.resolutionUrl.trim() || null,
    slaBreachUrl: data.slaBreachUrl.trim() || null,
  };

  return prisma.organizationWebhookConfig.upsert({
    where: { organizationId },
    update: normalized,
    create: { organizationId, ...normalized },
  });
}

// ORG_ONBOARDING_DESIGN.md §2.3 — OWNER dashboard's Integration Health widget. Presence
// check only (is a number mapped to this org at all), not a live reachability check.
export async function getWhatsAppNumberMapping(organizationId: string) {
  return prisma.whatsAppNumberMapping.findFirst({ where: { organizationId } });
}

// JOIN_REQUEST_DESIGN.md §3.2 — /onboarding's status-card branch: does this user already
// have a PENDING request outstanding? A pure read against the new JoinRequest model (§4).
export async function getPendingJoinRequestForUser(requesterId: string) {
  return prisma.joinRequest.findFirst({
    where: { requesterId, status: "PENDING" },
    include: { organization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * JOIN_REQUEST_DESIGN.md §5 — resolves a typed email to the org it owns. Returns a
 * discriminated result rather than a bare nullable so the Server Action can show §5's
 * two distinct rejection messages ("no such account" vs. "not an owner") even though
 * both ultimately mean "that person can't approve you" — not an information-disclosure
 * guard (this app's threat model doesn't treat email existence as sensitive), just
 * keeping the two messages §5 specifies distinct rather than collapsing them.
 */
export async function getOwnerOrgForEmail(
  email: string
): Promise<{ status: "not_found" } | { status: "not_owner" } | { status: "ok"; organization: { id: string; name: string } }> {
  const owner = await prisma.user.findUnique({
    where: { email },
    select: { role: true, organization: { select: { id: true, name: true } } },
  });

  if (!owner) return { status: "not_found" };
  if (owner.role !== "OWNER" || !owner.organization) return { status: "not_owner" };
  return { status: "ok", organization: owner.organization };
}

/**
 * JOIN_REQUEST_DESIGN.md §5 — the duplicate-pending-request check, read before insert so
 * the Server Action can surface a clean validation message instead of a raw @@unique
 * constraint violation from the schema.
 */
export async function getPendingJoinRequestToOrg(requesterId: string, organizationId: string) {
  return prisma.joinRequest.findFirst({
    where: { requesterId, organizationId, status: "PENDING" },
  });
}

/**
 * JOIN_REQUEST_DESIGN.md §5 — the actual insert, once the Server Action has confirmed
 * every case in §5's table doesn't apply. requestedOwnerEmail is stored as typed, kept
 * for the owner-side UI/audit even though it resolves to organizationId (§4).
 */
export async function createJoinRequest(requesterId: string, organizationId: string, requestedOwnerEmail: string) {
  return prisma.joinRequest.create({
    data: { requesterId, organizationId, requestedOwnerEmail },
  });
}

/**
 * JOIN_REQUEST_DESIGN.md §6 — the owner-side "Join Requests" section on /settings.
 */
export async function getPendingJoinRequestsForOrg(organizationId: string) {
  return prisma.joinRequest.findMany({
    where: { organizationId, status: "PENDING" },
    include: { requester: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}
