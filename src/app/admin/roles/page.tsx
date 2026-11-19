import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import {
  ADMIN_PERMISSION_LABELS,
  ALL_ADMIN_PERMISSIONS,
  adminRoster,
} from "@/services/admin/permissions";

import { cancelChangeAction, decideChangeAction, requestChangeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Roles and permissions | PropLink",
  robots: { index: false },
};

const field = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";

/**
 * Admin roles and permissions (Phase 6 Task 2, ADR-058; Q39-Q40). Super-admins
 * request grants and revocations; a different super-admin approves. The
 * database enforces the same rule.
 */
export default async function AdminRolesPage() {
  const session = await requireAdminPagePermission("SUPER_ADMIN");
  const me = session.user.authUserId;
  const { admins, pending } = await adminRoster();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Roles and permissions"
        description="Each Admin can do only what their permissions allow. Every change needs a reason and a second super-admin's approval, and is logged."
      />

      <Card>
        <CardTitle>Waiting for a second super-admin ({pending.length})</CardTitle>
        <CardBody>
          {pending.length === 0 ? (
            <p className="text-sm text-muted">No changes waiting.</p>
          ) : (
            <ul className="space-y-3" data-testid="grant-requests">
              {pending.map((request) => (
                <li
                  key={request.id}
                  className="rounded-lg border border-line p-3 text-sm"
                >
                  <p className="text-body">
                    <strong>{request.action === "GRANT" ? "Grant" : "Revoke"}</strong>{" "}
                    {ADMIN_PERMISSION_LABELS[request.permission]} for{" "}
                    {request.target.name ?? "an Admin"}
                  </p>
                  <p className="text-xs text-muted">
                    Asked by {request.requester.name ?? "a super-admin"} on{" "}
                    {day(request.createdAt)}: {request.reason}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {request.requestedBy === me ? (
                      <>
                        <p className="text-xs text-muted">
                          Another super-admin must approve your request.
                        </p>
                        <ActionButton
                          action={cancelChangeAction}
                          hidden={{ requestId: request.id }}
                          label="Cancel"
                          tone="secondary"
                        />
                      </>
                    ) : (
                      <>
                        <ActionButton
                          action={decideChangeAction}
                          hidden={{ requestId: request.id, decision: "approve" }}
                          label="Approve"
                        />
                        <ActionButton
                          action={decideChangeAction}
                          hidden={{ requestId: request.id, decision: "reject" }}
                          label="Reject"
                          tone="danger"
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Admin accounts</CardTitle>
        <CardBody>
          <ul className="space-y-4" data-testid="admin-roster">
            {admins.map((admin) => (
              <li key={admin.id} className="rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold text-primary">
                  {admin.name ?? "Admin"} {!admin.active && "(inactive)"}
                  {admin.id === me && " (you)"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {admin.adminGrants.length === 0
                    ? "No permissions: can see only the overview."
                    : admin.adminGrants
                        .map((grant) => ADMIN_PERMISSION_LABELS[grant.permission])
                        .join(" · ")}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-accent">
                    Request a change
                  </summary>
                  <div className="mt-2">
                    <ActionButton
                      action={requestChangeAction}
                      hidden={{ targetId: admin.id }}
                      label="Request"
                      tone="secondary"
                    >
                      <div className="flex flex-wrap gap-2">
                        <select
                          name="action"
                          className={field}
                          aria-label="Grant or revoke"
                        >
                          <option value="GRANT">Grant</option>
                          <option value="REVOKE">Revoke</option>
                        </select>
                        <select
                          name="permission"
                          className={field}
                          aria-label="Permission"
                        >
                          {ALL_ADMIN_PERMISSIONS.map((permission) => (
                            <option key={permission} value={permission}>
                              {ADMIN_PERMISSION_LABELS[permission]}
                            </option>
                          ))}
                        </select>
                        <input
                          name="reason"
                          required
                          minLength={5}
                          maxLength={500}
                          placeholder="Reason"
                          aria-label="Reason"
                          className={`${field} min-w-56 flex-1`}
                        />
                      </div>
                    </ActionButton>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
