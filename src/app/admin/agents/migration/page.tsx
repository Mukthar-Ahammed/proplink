import { requireAdminPagePermission } from "@/lib/authz";
import {
  listMigrationQueue,
  RENOTIFY_COOLDOWN_MS,
  type MigrationQueueState,
} from "@/services/agents/agentMigration";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge, type StatusTone } from "@/components/admin/StatusBadge";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

import { AuthoriseButton, NotifyForm } from "./MigrationForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Existing agents | PropLink" };

const TONE: Record<MigrationQueueState, StatusTone> = {
  CONFIRMED: "warning",
  NOT_NOTIFIED: "neutral",
  NOTIFIED: "brand",
  AUTHORISED: "success",
};

function formatDate(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "—";
}

function canNotify(
  row: Awaited<ReturnType<typeof listMigrationQueue>>[number],
  now: Date,
): boolean {
  if (!row.active) return false;
  if (row.state === "NOT_NOTIFIED") return true;
  if (row.state !== "NOTIFIED" || !row.migration?.notifiedAt) return false;
  return now.getTime() - row.migration.notifiedAt.getTime() >= RENOTIFY_COOLDOWN_MS;
}

/**
 * Existing agents migration (Phase 1 Task 5, ADR-025, Q2): email agents who
 * registered before invite-only onboarding, then authorise those who confirm.
 */
export default async function AdminAgentMigrationPage() {
  await requireAdminPagePermission("VERIFICATION");
  const queue = await listMigrationQueue();
  const now = new Date();

  const notifyRows = queue.map((row) => ({
    profileId: row.profileId,
    name: row.name,
    email: row.email,
    selectable: canNotify(row, now),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Existing agents"
        description="Agents who registered before invite-only onboarding. Email them, wait for them to confirm, then authorise. Their listings and leads keep working throughout."
      />

      <Card>
        <CardTitle>Notify</CardTitle>
        <CardBody>
          <NotifyForm rows={notifyRows} />
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Queue</CardTitle>
        <CardBody>
          {queue.length === 0 ? (
            <p className="text-sm text-muted">No existing agents need migrating.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="py-2 pr-4">Agent</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Emailed (UTC)</th>
                    <th className="py-2 pr-4">Company check</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((row) => (
                    <tr
                      key={row.profileId}
                      className="border-t border-line align-top"
                      data-testid={`migration-row-${row.profileId}`}
                    >
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-primary">{row.name}</div>
                        {row.email && (
                          <div className="text-xs break-all text-muted">{row.email}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={row.state} tone={TONE[row.state]} />
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {formatDate(row.migration?.notifiedAt)}
                        {row.migration && row.migration.notifyCount > 1
                          ? ` (${row.migration.notifyCount} times)`
                          : ""}
                      </td>
                      <td className="py-3 pr-4 text-xs">{row.companyStatus}</td>
                      <td className="py-3">
                        {row.state === "CONFIRMED" ? (
                          <AuthoriseButton profileId={row.profileId} name={row.name} />
                        ) : row.state === "AUTHORISED" ? (
                          <span className="text-xs text-muted">
                            Authorised {formatDate(row.migration?.authorisedAt)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">
                            Waiting for the agent
                          </span>
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
