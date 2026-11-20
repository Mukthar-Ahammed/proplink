import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  DetailTabs,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { requireAdminPagePermission } from "@/lib/authz";
import { deliveryHealth } from "@/services/admin/deliveryHealth";
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
export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await requireAdminPagePermission("SYSTEM_INTEGRATIONS");
  const [kpis, delivery] = await Promise.all([adminKpis(), deliveryHealth()]);
  const waiting = kpis.queues.reduce((sum, queue) => sum + queue.waiting, 0);
  const deliveryProblems = delivery.deliveries.filter((row) => row.attention).length;
  const tabs: DetailTab[] = [
    { key: "queues", label: "Queues", count: waiting, attention: waiting > 0 },
    { key: "delivery", label: "Emails & webhooks", attention: deliveryProblems > 0 },
    { key: "growth", label: "Subscriptions & growth" },
  ];
  const tab = pickTab((await searchParams).tab, tabs);
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="KPIs"
        description="Queue times, chat authorisations, email and webhook health, subscriptions and the last 30 days' funnel. Counts only."
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
      <KeyFacts
        items={[
          { label: "Waiting in queues", value: waiting },
          { label: "Delivery problems", value: deliveryProblems },
          { label: "Projects published (30 days)", value: kpis.funnel.projectsPublished },
          { label: "Purchases completed (30 days)", value: kpis.funnel.dealsCompleted },
        ]}
      />
      <DetailTabs
        basePath="/admin/system"
        tabs={tabs}
        current={tab}
        label="KPI sections"
      />
      {tab === "queues" && (
        <TabBody>
          <Panel
            title="Queues"
            description="How many items wait in each Admin queue, and how long the oldest has waited."
          >
            <div className="overflow-x-auto">
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
                      <td className="py-2 text-muted">
                        {"note" in queue ? queue.note : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabBody>
      )}
      {tab === "delivery" && (
        <TabBody>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Emails and alerts"
              description="Messages PropLink sends. Red figures need attention."
            >
              <dl className="space-y-1 text-sm" data-testid="kpi-deliveries">
                {delivery.deliveries.map((row) => (
                  <div key={row.name} className="flex justify-between gap-4">
                    <dt className="text-muted">{row.name}</dt>
                    <dd
                      className={
                        row.attention
                          ? "font-semibold text-danger"
                          : "font-semibold text-primary"
                      }
                    >
                      {row.value}
                      {row.attention ? (
                        <span className="sr-only"> (needs attention)</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel
              title="Webhooks received"
              description="Providers retry until PropLink accepts an event; each is recorded once."
            >
              <table className="mt-2 w-full text-left text-sm" data-testid="kpi-webhooks">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 font-semibold">Provider</th>
                    <th className="py-1 font-semibold">24 h</th>
                    <th className="py-1 font-semibold">Last received</th>
                  </tr>
                </thead>
                <tbody>
                  {delivery.webhooks.map((hook) => (
                    <tr key={hook.provider} className="border-t border-line">
                      <td className="py-2 text-body">{hook.provider}</td>
                      <td className="py-2 text-body">{hook.last24h}</td>
                      <td className="py-2 text-body">
                        {hook.minutesAgo === null
                          ? "Never"
                          : `${age(hook.minutesAgo)} ago`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </TabBody>
      )}
      {tab === "growth" && (
        <TabBody>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Subscriptions"
              description="Active, trialling and past-due subscriptions by plan."
            >
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
            </Panel>
            <Panel
              title="Last 30 days"
              description="Sign-ups and deals completed across the pipeline."
            >
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
            </Panel>
          </div>
        </TabBody>
      )}
    </div>
  );
}
