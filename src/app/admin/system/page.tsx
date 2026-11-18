import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { adminKpis } from "@/services/admin/kpis";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — KPIs | PropLink", robots: { index: false } };

function age(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

/** Admin KPIs (Phase 6 Task 4, ADR-061): queues, chats, subscriptions, funnel. */
export default async function AdminSystemPage() {
  await requireAdminPagePermission("SYSTEM_INTEGRATIONS");
  const kpis = await adminKpis();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="KPIs"
        description="Queue times, chat authorisations, subscriptions and the last 30 days' funnel. Counts only."
      />
      <nav aria-label="System pages" className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/admin/system/integrations"
          className="rounded-full border border-line bg-white px-3 py-1 text-primary"
        >
          Integrations health
        </Link>
        <Link
          href="/admin/system/security"
          className="rounded-full border border-line bg-white px-3 py-1 text-primary"
        >
          Security events
        </Link>
      </nav>
      <Card>
        <CardTitle>Queues</CardTitle>
        <CardBody>
          <table className="w-full text-left text-sm" data-testid="kpi-queues">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-semibold">Queue</th>
                <th className="py-1 font-semibold">Waiting</th>
                <th className="py-1 font-semibold">Oldest</th>
                <th className="py-1 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {kpis.queues.map((queue) => (
                <tr key={queue.name} className="border-t border-line">
                  <td className="py-2 text-body">{queue.name}</td>
                  <td className="py-2 text-body">{queue.waiting}</td>
                  <td className="py-2 text-body">{age(queue.oldestMinutes)}</td>
                  <td className="py-2 text-muted">{"note" in queue ? queue.note : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Subscriptions (active, trial, past due)</CardTitle>
          <CardBody>
            {kpis.subscriptions.length === 0 ? (
              <p className="text-sm text-muted">No subscriptions yet.</p>
            ) : (
              <ul className="space-y-1 text-sm text-body">
                {kpis.subscriptions.map((s) => (
                  <li key={`${s.audience}-${s.status}`}>
                    {s.audience.replaceAll("_", " ").toLowerCase()} ·{" "}
                    {s.status.replace("_", " ").toLowerCase()}: {s.count}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Last 30 days</CardTitle>
          <CardBody>
            <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="kpi-funnel">
              {kpis.funnel.signupsByRole.map((s) => (
                <div key={s.role}>
                  <dt className="text-muted">New {s.role.toLowerCase()} accounts</dt>
                  <dd className="font-semibold text-primary">{s.count}</dd>
                </div>
              ))}
              {[
                ["KYC approved", kpis.funnel.kycApproved],
                ["Mandates accepted", kpis.funnel.mandatesAccepted],
                ["Projects published", kpis.funnel.projectsPublished],
                ["Projects sold", kpis.funnel.projectsSold],
                ["Offers made", kpis.funnel.offers],
                ["Purchases completed", kpis.funnel.dealsCompleted],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-semibold text-primary">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
