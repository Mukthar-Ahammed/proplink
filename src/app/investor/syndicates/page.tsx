import { redirect } from "next/navigation";
import { requirePageRole, hasInvestorCapability } from "@/lib/authz";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { getInvestorDashboard } from "@/services/syndicates/investorDashboard";
import {
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  PledgeCard,
  PrimaryLink,
  ScaleIcon,
  SearchIcon,
  ShieldIcon,
  StatStrip,
} from "@/components/investor/InvestorUi";

export const dynamic = "force-dynamic";

export default async function SyndicateOpportunitiesPage() {
  const session = await requirePageRole("INVESTOR");
  if (!hasInvestorCapability(session.user, "SYNDICATE")) {
    redirect("/investor");
  }

  const data = await getInvestorDashboard(session.user);
  const active = data.pledges.filter((p) => p.status !== "WITHDRAWN");

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Syndicate"
          tail="deals"
          description="Pooled refurbishment and development projects: one Lead Investor plus Co-Investors."
        />

        <div className="flex items-start gap-3 rounded-3xl border border-accent/20 bg-pale/70 p-5 sm:p-6">
          <IconChip>
            <ShieldIcon />
          </IconChip>
          <p className="text-sm leading-relaxed text-body">
            Syndicate participation is{" "}
            <strong className="text-primary">expression-of-interest only</strong>. No
            money moves on-platform and pledges carry no binding financial commitment —
            agreements are prepared by the project Solicitor, and funds move only through
            solicitor-managed bank accounts.
          </p>
        </div>

        <StatStrip
          items={[
            {
              value: formatPenceGBP(data.summary.committedGBP),
              label: "Committed intent",
              hint: "Pledged, not paid",
            },
            { value: data.summary.projectCount, label: "Syndicates" },
            { value: active.length, label: "Active pledges" },
            { value: data.savedCount, label: "Saved properties" },
          ]}
        />
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle
          title="Your syndicate"
          tail="pledges"
          description="Funding progress counts every standing pledge on the project, not just yours."
        />
        {data.pledges.length === 0 ? (
          <InvestorEmpty
            title="No active syndicate pledges"
            action={
              <PrimaryLink href="/marketplace">Browse marketplace deals</PrimaryLink>
            }
          >
            Expressions of interest will be listed here once you register one.
          </InvestorEmpty>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {data.pledges.map((p) => (
              <PledgeCard key={p.id} pledge={p} />
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <IconChip>
            <SearchIcon />
          </IconChip>
          <p className="mt-5 font-semibold text-primary">Discover syndicates</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Explore available deals in the marketplace to register expressions of
            interest.
          </p>
          <div className="mt-5">
            <PrimaryLink href="/marketplace">Browse the marketplace</PrimaryLink>
          </div>
        </div>
        <div className="rounded-3xl border border-line bg-surface/70 p-6 sm:p-7">
          <IconChip>
            <ScaleIcon />
          </IconChip>
          <p className="mt-5 font-semibold text-primary">From interest to agreement</p>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
            <li>1. Register your interest in a project here.</li>
            <li>2. The project Solicitor prepares the agreement under UK law.</li>
            <li>3. Funds move outside PropLink, through solicitor-managed accounts.</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
