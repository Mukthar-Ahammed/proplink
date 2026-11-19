import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { getBillingProvider } from "@/services/billing";
import {
  getBillingSettings,
  listActivePlans,
  subscriptionOverview,
} from "@/services/billing/subscriptions";

import { GraceForm, PriceForm } from "./BillingAdminForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Subscriptions | PropLink" };

const AUDIENCES = [
  ["AGENT", "Agent"],
  ["LEAD_INVESTOR", "Lead Investor"],
  ["CO_INVESTOR", "Co-Investor"],
] as const;

/**
 * Subscription prices, grace period and overview (Phase 3 Tasks 1 and 8,
 * ADR-042; OD-01). Only Agents, Lead Investors and Co-Investors pay.
 */
export default async function AdminBillingPage() {
  await requireAdminPagePermission("SUBSCRIPTION_PRICING");
  const [plans, settings, overview] = await Promise.all([
    listActivePlans(),
    getBillingSettings(),
    subscriptionOverview(),
  ]);
  const provider = getBillingProvider().name;
  const price = (audience: string, interval: string) => {
    const plan = plans.find(
      (row) => row.audience === audience && row.interval === interval,
    );
    return plan ? (plan.amountGBP / 100).toFixed(2) : "";
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscriptions"
        description="Agents, Lead Investors and Co-Investors subscribe monthly or yearly. Landlords and Buyers never pay."
        badge={
          provider === "mock"
            ? { label: "Mock provider (development)", tone: "warning" }
            : { label: "Stripe", tone: "success" }
        }
      />
      <Card>
        <CardTitle>Prices (GBP)</CardTitle>
        <CardBody>
          <p className="mb-4 text-sm text-muted">
            Changing a price creates a new price at the payment provider. New subscribers
            pay it; existing subscribers keep their price until they change plan.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="py-2 pr-4">Plan</th>
                  <th className="py-2 pr-4">Monthly</th>
                  <th className="py-2">Yearly</th>
                </tr>
              </thead>
              <tbody>
                {AUDIENCES.map(([audience, label]) => (
                  <tr key={audience} className="border-t border-line align-top">
                    <td className="py-3 pr-4 font-semibold text-primary">{label}</td>
                    <td className="py-3 pr-4">
                      <PriceForm
                        audience={audience}
                        interval="MONTH"
                        current={price(audience, "MONTH")}
                      />
                    </td>
                    <td className="py-3">
                      <PriceForm
                        audience={audience}
                        interval="YEAR"
                        current={price(audience, "YEAR")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Failed payments</CardTitle>
        <CardBody>
          <GraceForm graceDays={settings.graceDays} />
          <p className="mt-2 text-xs text-muted">
            The payment provider retries automatically. After the grace period, chats
            become read-only until the subscription is renewed.
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Subscribers</CardTitle>
        <CardBody>
          {overview.recent.length === 0 ? (
            <p className="text-sm text-muted">No subscriptions yet.</p>
          ) : (
            <>
              <ul className="mb-4 flex flex-wrap gap-2 text-xs">
                {overview.byStatus.map((group) => (
                  <li key={`${group.audience}-${group.status}`}>
                    <StatusBadge
                      status={group.status}
                      label={`${group.audience.replace("_", " ").toLowerCase()} · ${group.status.toLowerCase().replace("_", " ")}: ${group._count._all}`}
                    />
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="py-2 pr-4">Subscriber</th>
                      <th className="py-2 pr-4">Plan</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2">Period ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recent.map((row) => (
                      <tr key={row.id} className="border-t border-line">
                        <td className="py-2 pr-4">
                          {row.profile.name ?? row.profile.role}
                        </td>
                        <td className="py-2 pr-4">
                          {row.audience.replace("_", " ").toLowerCase()} ·{" "}
                          {row.interval === "YEAR" ? "yearly" : "monthly"}
                        </td>
                        <td className="py-2 pr-4">
                          <StatusBadge status={row.status} />
                          {row.cancelAtPeriodEnd && (
                            <span className="ml-2 text-xs text-muted">
                              ends at period end
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          {row.currentPeriodEnd?.toISOString().slice(0, 10) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
