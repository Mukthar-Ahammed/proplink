import { requireAdminPagePermission } from "@/lib/authz";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata = { title: "Admin — Fees & Billing Rules" };

/**
 * What PropLink charges for, per the business PDFs (Clarification Answers §D)
 * and AGENTS.md constraint 1: subscriptions for Agents, Lead Investors and
 * Co-Investors are the only payments in the app. The earlier plan's success
 * fees are superseded (ADR-019) and are not shown here. Read-only: prices are
 * set on the subscription billing page that Phase 3 adds (ADR-042), not here.
 */
const CHARGED = [
  {
    title: "Agent subscription",
    detail: "Monthly or yearly. Needed to chat and to work the private pipeline.",
  },
  {
    title: "Lead Investor subscription",
    detail: "Monthly or yearly. Needed for project chat and to lead a project.",
  },
  {
    title: "Co-Investor subscription",
    detail: "Monthly or yearly. Needed for project chat.",
  },
];

const NEVER_CHARGED = [
  "Landlords and Buyers never pay.",
  "No success fees or commission on sales.",
  "No investment money in the app: pledges are settled through Solicitor-managed bank accounts outside PropLink.",
];

export default async function FeesPage() {
  await requireAdminPagePermission("SUBSCRIPTION_PRICING");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Fees & Billing Rules"
        description="What PropLink charges for, and what it never charges for."
      />

      <section className="rounded-xl border border-line bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-primary">Subscriptions</h2>
          <span className="rounded-full bg-pale px-2.5 py-0.5 text-xs font-semibold text-accent">
            The only payments in the app
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Paid through Stripe&apos;s hosted checkout, so card details never reach
          PropLink.
        </p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3">
          {CHARGED.map((plan) => (
            <li key={plan.title} className="rounded-lg border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-primary">{plan.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{plan.detail}</p>
              <p className="mt-3 text-xs font-medium text-secondary">
                Price: not set yet
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Prices, the yearly discount and the failed-payment grace period are Admin
          settings on the subscription billing page, which arrives with Phase 3. The owner
          has not decided the prices yet (OD-01).
        </p>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-line bg-white p-6 shadow-xs">
          <h2 className="text-base font-bold text-primary">Never charged</h2>
          <ul className="mt-3 space-y-2">
            {NEVER_CHARGED.map((rule) => (
              <li key={rule} className="flex gap-2 text-sm text-body">
                <span aria-hidden className="mt-0.5 text-muted">
                  ✕
                </span>
                {rule}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-white p-6 shadow-xs">
          <h2 className="text-base font-bold text-primary">Awaiting an owner decision</h2>
          <p className="mt-3 text-sm text-body">
            <span className="font-semibold">Advertising.</span> Placements are approved by
            Admin and labelled Sponsored, but there is no billing until the owner sets a
            pricing model (OD-11).
          </p>
        </section>
      </div>
    </div>
  );
}
