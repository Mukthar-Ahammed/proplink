import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { securityEventSummary } from "@/services/security/securityEvents";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Security events | PropLink",
  robots: { index: false },
};

/**
 * Security events (Phase 6 Task 4, ADR-061): counts of refused requests,
 * failed sign-ins, webhook problems and Admin permission refusals. Counts
 * only; details are in the server logs.
 */
export default async function AdminSecurityEventsPage() {
  await requireAdminPagePermission("SYSTEM_INTEGRATIONS");
  const summary = await securityEventSummary();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Security events"
        description="Counts for the last 24 hours and 7 days, with an hourly bar for the last day. No personal data is stored; details are in the server logs."
      />
      <Card>
        <CardBody>
          <table className="w-full text-left text-sm" data-testid="security-events">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-semibold">Event</th>
                <th className="py-1 font-semibold">24 h</th>
                <th className="py-1 font-semibold">7 days</th>
                <th className="py-1 font-semibold">Last 24 hours, by hour</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => {
                const peak = Math.max(1, ...row.hourly);
                return (
                  <tr key={row.kind} className="border-t border-line">
                    <td className="py-2 text-body">{row.label}</td>
                    <td className="py-2 font-semibold text-primary">{row.lastDay}</td>
                    <td className="py-2 text-body">{row.lastWeek}</td>
                    <td className="py-2">
                      <div
                        className="flex h-6 items-end gap-px"
                        role="img"
                        aria-label={`${row.lastDay} in the last 24 hours`}
                      >
                        {row.hourly.map((count, i) => (
                          <span
                            key={i}
                            className="w-1.5 bg-accent/70"
                            style={{ height: `${Math.max(2, (count / peak) * 24)}px` }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
