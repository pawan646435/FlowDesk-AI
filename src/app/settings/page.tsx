import { getVerifiedSession } from "@/lib/session";
import { redirect } from "next/navigation";
import {
  getOrganizationMembers,
  getOrganizationWebhookConfig,
  getOrganizationProfile,
  getPendingInvitesForUser,
  getPendingJoinRequestsForOrg,
} from "@/services/organization.service";
import { InviteTeammateForm } from "@/components/invite-teammate-form";
import { WebhookConfigForm } from "@/components/webhook-config-form";
import { RemoveMemberButton } from "@/components/remove-member-button";
import { LeaveOrgButton } from "@/components/leave-org-button";
import { JoinRequestActionButtons } from "@/components/join-request-actions-buttons";
import { INDUSTRY_LABELS, SIZE_LABELS } from "@/lib/company-options";
import Link from "next/link";
import { Users, Crown, Webhook, Building2, Globe, Mail, ArrowRight, UserPlus } from "lucide-react";

export default async function SettingsPage() {
  // JOIN_REQUEST_DESIGN.md §3.3 — same pattern as dashboard/page.tsx: distinguish
  // unauthenticated (redirects to /login, inside the helper) from authenticated-but-
  // orgless (redirected to /onboarding below) rather than treating both identically.
  const initialSession = await getVerifiedSession({ onStale: "redirect", requireOrg: false });
  if (!initialSession.user.organizationId) {
    redirect("/onboarding");
  }

  const session = await getVerifiedSession();
  const isOwner = session.user.role === "OWNER";

  const [members, webhookConfig, orgProfile, pendingInvites, pendingJoinRequests] = await Promise.all([
    getOrganizationMembers(session.user.organizationId),
    getOrganizationWebhookConfig(session.user.organizationId),
    getOrganizationProfile(session.user.organizationId),
    session.user.email ? getPendingInvitesForUser(session.user.email) : Promise.resolve([]),
    // JOIN_REQUEST_DESIGN.md §6 — OWNER-only, no reason to run this query for a MEMBER.
    isOwner ? getPendingJoinRequestsForOrg(session.user.organizationId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your organization&apos;s team.</p>
      </div>

      {/* TEAM_REMOVAL_DESIGN.md §3.2/§3.4 — Pending Invites, /settings as the primary
          location (open decision resolved). Independent of session.user.organizationId
          entirely — shows regardless of whether the viewer currently has an org. Invites
          to the viewer's own current org are filtered out here since accepting one isn't
          a meaningful "switch" prompt. */}
      {pendingInvites.filter((inv) => inv.organizationId !== session.user.organizationId).length > 0 && (
        <div className="rounded-2xl border border-primary/30 glass p-6 space-y-4 glow-purple">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Pending Invites</h2>
          </div>
          <div className="space-y-3">
            {pendingInvites
              .filter((inv) => inv.organizationId !== session.user.organizationId)
              .map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between rounded-xl border border-border/40 bg-background/30 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{invite.organization.name}</p>
                    <p className="text-xs text-muted-foreground">Invited as {invite.role}</p>
                  </div>
                  <Link
                    href={`/accept-invite?token=${invite.token}`}
                    className="flex items-center gap-1.5 shrink-0 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition-all cursor-pointer"
                  >
                    View
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* JOIN_REQUEST_DESIGN.md §6 — Join Requests: requests OTHER people sent to this
          org, OWNER-only. Deliberately visually distinct from "Pending Invites" above
          (different accent, different border treatment) — different direction (incoming
          vs. outgoing), different audience (any viewer vs. OWNER-only). */}
      {isOwner && pendingJoinRequests.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 glass p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-amber-400" />
            <h2 className="text-xl font-semibold">Join Requests</h2>
          </div>
          <div className="space-y-3">
            {pendingJoinRequests.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between rounded-xl border border-border/40 bg-background/30 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {request.requester.name || "Unnamed"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{request.requester.email}</p>
                </div>
                <JoinRequestActionButtons
                  requestId={request.id}
                  requesterName={request.requester.name || request.requester.email || "this person"}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Org Profile</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">Industry</span>
            <span className="text-sm text-foreground mt-1 block">
              {orgProfile?.industry ? INDUSTRY_LABELS[orgProfile.industry] : "Not set"}
            </span>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">Company size</span>
            <span className="text-sm text-foreground mt-1 block">
              {orgProfile?.size ? SIZE_LABELS[orgProfile.size] : "Not set"}
            </span>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">Website</span>
            {orgProfile?.website ? (
              <a
                href={orgProfile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline mt-1 flex items-center gap-1"
              >
                <Globe className="h-3.5 w-3.5" />
                {orgProfile.website}
              </a>
            ) : (
              <span className="text-sm text-foreground mt-1 block">Not set</span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <h2 className="text-xl font-semibold">Invite a teammate</h2>
        {isOwner ? (
          <InviteTeammateForm />
        ) : (
          <p className="text-sm text-muted-foreground">
            Only organization owners can invite teammates.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border/40 glass overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-border/40">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Team members</h2>
        </div>
        <div className="divide-y divide-border/30">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between px-6 py-4"
            >
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">
                  {member.name || "Unnamed"}
                </p>
                <p className="text-sm text-muted-foreground truncate">{member.email}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {member.role === "OWNER" && (
                  <span className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Crown className="h-3 w-3" />
                    Owner
                  </span>
                )}
                {/* TEAM_REMOVAL_DESIGN.md §2.4 — visible only when isOwner && member.role
                    !== "OWNER"; mirrors, does not substitute for, removeMemberAction's own
                    server-side OWNER-target block and org-membership check. */}
                {isOwner && member.role !== "OWNER" && (
                  <RemoveMemberButton memberId={member.id} memberName={member.name || member.email || "this teammate"} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TEAM_REMOVAL_DESIGN.md §2.4 — a MEMBER viewing their own settings sees a "Leave
          organization" action instead; not shown to OWNER, matching §2.3's block. */}
      {!isOwner && (
        <div className="rounded-2xl border border-border/40 glass p-6 space-y-3">
          <h2 className="text-xl font-semibold">Leave organization</h2>
          <p className="text-sm text-muted-foreground">
            You&apos;ll immediately lose access to this organization&apos;s tickets, knowledge base, and settings.
          </p>
          <LeaveOrgButton />
        </div>
      )}

      <div className="rounded-2xl border border-border/40 glass p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Webhook className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">n8n webhook settings</h2>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Configure where each event type sends notifications for your organization. Leave a field blank to skip that webhook.
        </p>
        {isOwner ? (
          <WebhookConfigForm
            defaults={{
              newTicketUrl: webhookConfig?.newTicketUrl ?? "",
              escalationUrl: webhookConfig?.escalationUrl ?? "",
              negativeSentimentUrl: webhookConfig?.negativeSentimentUrl ?? "",
              resolutionUrl: webhookConfig?.resolutionUrl ?? "",
              slaBreachUrl: webhookConfig?.slaBreachUrl ?? "",
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Only organization owners can edit webhook settings.
          </p>
        )}
      </div>
    </div>
  );
}
