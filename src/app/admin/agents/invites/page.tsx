import { requireAdminPagePermission } from "@/lib/authz";
import { listAgentInvites } from "@/services/agents/agentInvites";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge, type StatusTone } from "@/components/admin/StatusBadge";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

import { revokeInviteAction } from "./actions";
import { CreateInviteForm, ResendInviteButton } from "./InviteForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Agent invites | PropLink" };

const TONE: Record<string, StatusTone> = {
  PENDING: "brand",
  ACCEPTED: "success",
  EXPIRED: "warning",
  REVOKED: "danger",
  SUPERSEDED: "neutral",
};

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "—";
}

/**
 * Agent invitations (Phase 1 Task 3, ADR-023). Agents cannot self-register;
 * this page is the only way an Agent account comes to exist.
 */
export default async function AdminAgentInvitesPage() {
  await requireAdminPagePermission("VERIFICATION");
  const invites = await listAgentInvites();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Agent invites"
        description="Agents join by invitation only. Each link works once, only for the invited email, and expires after 7 days. Resending replaces the previous link."
      />

      <Card>
        <CardTitle>Invite an agent</CardTitle>
        <CardBody>
          <CreateInviteForm />
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Recent invitations</CardTitle>
        <CardBody>
          {invites.length === 0 ? (
            <p className="text-sm text-muted">No invitations yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Sent (UTC)</th>
                    <th className="py-2 pr-4">Expires (UTC)</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => (
                    <tr key={invite.id} className="border-t border-line align-top">
                      <td className="py-2 pr-4 break-all">{invite.email}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge
                          status={invite.state}
                          tone={TONE[invite.state] ?? "neutral"}
                        />
                      </td>
                      <td className="py-2 pr-4">{formatDate(invite.createdAt)}</td>
                      <td className="py-2 pr-4">{formatDate(invite.expiresAt)}</td>
                      <td className="py-2">
                        {(invite.state === "PENDING" || invite.state === "EXPIRED") && (
                          <div className="flex flex-col gap-2">
                            <ResendInviteButton inviteId={invite.id} />
                            {invite.state === "PENDING" && (
                              <form action={revokeInviteAction}>
                                <input type="hidden" name="inviteId" value={invite.id} />
                                <button
                                  type="submit"
                                  className="text-sm font-semibold text-danger underline"
                                >
                                  Revoke
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
