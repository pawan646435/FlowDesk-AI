import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getOrganizationMembers, getOrganizationWebhookConfig } from "@/services/organization.service";
import { InviteTeammateForm } from "@/components/invite-teammate-form";
import { WebhookConfigForm } from "@/components/webhook-config-form";
import { Users, Crown, Webhook } from "lucide-react";

export default async function SettingsPage() {
  const session = await auth();

  if (!session || !session.user?.id || !session.user?.organizationId) {
    redirect("/login");
  }

  const [members, webhookConfig] = await Promise.all([
    getOrganizationMembers(session.user.organizationId),
    getOrganizationWebhookConfig(session.user.organizationId),
  ]);
  const isOwner = session.user.role === "OWNER";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your organization&apos;s team.</p>
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
              {member.role === "OWNER" && (
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Crown className="h-3 w-3" />
                  Owner
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

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
