import prisma from "@/lib/prisma";
import crypto from "crypto";
import { OrganizationRole } from "@prisma/client";

const INVITE_EXPIRY_DAYS = 7; // MULTI_TENANCY_DESIGN.md §9.2

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
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

/**
 * MULTI_TENANCY_DESIGN.md §9.1 — self-invitation org creation. Creates the
 * Organization, then an Invite targeting the creator's own email with role OWNER.
 * No User row is created here; the invite is consumed via the normal §9.3 sign-in path.
 */
export async function createOrganizationWithSelfInvite(orgName: string, email: string) {
  const slug = await uniqueSlug(orgName);

  const organization = await prisma.organization.create({
    data: { name: orgName, slug },
  });

  // invitedById is left null — no User row exists yet at self-invite time (schema
  // change: Invite.invitedById is nullable specifically for this case, see schema.prisma).
  const invite = await prisma.invite.create({
    data: {
      email,
      organizationId: organization.id,
      token: generateInviteToken(),
      role: OrganizationRole.OWNER,
      expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { organization, invite };
}

/**
 * MULTI_TENANCY_DESIGN.md §9.6 — invite a teammate. Refreshes (rather than duplicates)
 * a pending invite for the same org+email per §9.2's @@unique([organizationId, email]).
 */
export async function createTeamInvite(organizationId: string, invitedById: string, email: string) {
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const invite = await prisma.invite.upsert({
    where: { organizationId_email: { organizationId, email } },
    update: { token, expiresAt, invitedById, acceptedAt: null },
    create: {
      email,
      organizationId,
      token,
      invitedById,
      role: OrganizationRole.MEMBER,
      expiresAt,
    },
  });

  return invite;
}

export async function getInviteByToken(token: string) {
  return prisma.invite.findUnique({
    where: { token },
    include: { organization: true },
  });
}

export async function getOrganizationMembers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
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
