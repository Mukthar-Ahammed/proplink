import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { EXPORT_DAYS, listDataExports } from "@/services/admin/dataExport";

import { dataExportAction } from "../cases/actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Data requests | PropLink",
  robots: { index: false },
};

const field = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";

/**
 * GDPR data requests (Phase 6 Task 3, ADR-059; Q42): one case manager records
 * a subject-access request, a second approves, then the export downloads
 * for a limited time. Every step is audited.
 */
export default async function AdminPrivacyPage() {
  const session = await requireAdminPagePermission("CASE_MANAGEMENT");
  const me = session.user.authUserId;
  const requests = await listDataExports({
    profileId: me,
    legacyUserId: session.user.id,
    role: session.user.role,
  });
  const now = new Date();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Data requests"
        description={`Subject-access exports under UK GDPR. A second case manager approves each request; the export can then be downloaded for ${EXPORT_DAYS} days. Every step and download is logged.`}
      />
      <Card>
        <CardTitle>Record a request</CardTitle>
        <CardBody>
          <ActionButton
            action={dataExportAction}
            hidden={{ intent: "request" }}
            label="Record request"
          >
            <div className="flex flex-wrap gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="Member's email"
                aria-label="Member's email"
                className={field}
              />
              <input
                name="reason"
                required
                minLength={5}
                maxLength={500}
                placeholder="Reason (e.g. member's emailed request)"
                aria-label="Reason"
                className={`${field} min-w-64 flex-1`}
              />
            </div>
          </ActionButton>
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Requests</CardTitle>
        <CardBody>
          {requests.length === 0 ? (
            <p className="text-sm text-muted">No data requests.</p>
          ) : (
            <ul className="space-y-3" data-testid="data-requests">
              {requests.map((request) => {
                const live =
                  request.status === "APPROVED" &&
                  request.expiresAt &&
                  request.expiresAt > now;
                return (
                  <li
                    key={request.id}
                    className="rounded-lg border border-line p-3 text-sm"
                  >
                    <p className="text-body">
                      {request.subject.name ?? "Member"} (
                      {request.subject.role.toLowerCase()}) ·{" "}
                      {request.status.toLowerCase()} · {day(request.createdAt)}
                    </p>
                    <p className="text-xs text-muted">
                      Recorded by {request.requester.name ?? "an Admin"}: {request.reason}
                      {request.decider &&
                        ` · decided by ${request.decider.name ?? "an Admin"}`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {request.status === "REQUESTED" &&
                        (request.requestedBy === me ? (
                          <p className="text-xs text-muted">
                            A second case manager must approve it.
                          </p>
                        ) : (
                          <>
                            <ActionButton
                              action={dataExportAction}
                              hidden={{ intent: "approve", requestId: request.id }}
                              label="Approve"
                            />
                            <ActionButton
                              action={dataExportAction}
                              hidden={{ intent: "reject", requestId: request.id }}
                              label="Reject"
                              tone="danger"
                            />
                          </>
                        ))}
                      {live && (
                        <a
                          href={`/api/admin/data-exports/${request.id}`}
                          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white"
                        >
                          Download export (until {day(request.expiresAt)})
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
