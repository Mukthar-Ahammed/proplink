import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole, hasInvestorCapability } from "@/lib/authz";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { getInvestorDashboard } from "@/services/syndicates/investorDashboard";
import { PortalEmpty, PortalSection } from "@/components/portal/PortalShell";

export const dynamic = "force-dynamic";

export default async function SyndicateOpportunitiesPage() {
  const session = await requirePageRole("INVESTOR");
  if (!hasInvestorCapability(session.user, "SYNDICATE")) {
    redirect("/investor");
  }

  const data = await getInvestorDashboard(session.user);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <h2 className="text-xl font-bold text-primary">Syndicate Opportunities</h2>
          <p className="mt-1 text-sm text-muted">
            Pooled property investment opportunities and expressions of interest.
          </p>
        </div>
        <span className="rounded-full border border-accent/30 bg-pale px-3.5 py-1 text-xs font-semibold text-secondary">
          Subtype: SYNDICATE
        </span>
      </div>

      <p className="rounded-xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-muted">
        Syndicate participation is <strong>expression-of-interest only</strong>.
        No money moves on-platform and pledges carry no binding financial commitment.
      </p>

      <PortalSection title="Your Syndicate Pledges">
        {data.pledges.length === 0 ? (
          <PortalEmpty>
            No active syndicate pledges. Expressions of interest will be listed here.
          </PortalEmpty>
        ) : (
          <ul className="border-t border-line">
            {data.pledges.map((p) => (
              <li key={p.id} className="border-b border-line py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="font-medium text-primary">{p.project.name}</p>
                  <p className="text-sm text-muted">
                    {formatPenceGBP(p.amountGBP)} · {p.equityPct}% equity
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted">{p.project.propertyTitle}</p>
                <div className="mt-3 flex items-center gap-3">
                  <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-pale">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${p.project.fundedPct}%` }}
                    />
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {p.project.fundedPct}% of {formatPenceGBP(p.project.capitalTargetGBP)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>

      <PortalSection title="Syndicate Discovery">
        <div className="rounded-xl border border-line bg-white p-6 text-sm leading-relaxed text-muted">
          <p>
            Explore available deals in the marketplace to register expressions of interest.
          </p>
          <div className="mt-4">
            <Link
              href="/marketplace"
              className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
            >
              Browse marketplace deals &rarr;
            </Link>
          </div>
        </div>
      </PortalSection>
    </div>
  );
}
