import { AdSlot } from "@/components/ads/AdSlot";
import Link from "next/link";
import { requirePageRole, hasInvestorCapability } from "@/lib/authz";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { getInvestorDashboard } from "@/services/syndicates/investorDashboard";
import { PortalEmpty, PortalSection, StatCard } from "@/components/portal/PortalShell";
import { CompleteInvestorSubtypeForm } from "@/components/investor/CompleteInvestorSubtypeForm";
import { InvestorType } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const KYC_COPY: Record<string, { tone: string; text: string }> = {
  NOT_STARTED: {
    tone: "bg-warning/10 text-warning",
    text: "Identity verification not started. Identity verification is required before accessing protected financial actions.",
  },
  PENDING: {
    tone: "bg-warning/10 text-warning",
    text: "Identity verification in progress. Verification is under review.",
  },
  APPROVED: {
    tone: "bg-success/15 text-success",
    text: "Identity verified. Financial features will be unlocked as they become available.",
  },
  REJECTED: {
    tone: "bg-danger/15 text-danger",
    text: "Identity verification requires attention. Contact support to resolve it.",
  },
};

const SUBTYPE_BADGE_COPY: Record<InvestorType, string> = {
  FLIPPER: "Property Flipper",
  SYNDICATE: "Syndicate Investor",
  BOTH: "Flipper + Syndicate",
};

export default async function InvestorPage() {
  const { user } = await requirePageRole("INVESTOR");

  // Handle NULL subtype: render onboarding form and suppress operational modules
  if (!user.investorType) {
    return (
      <div className="py-6">
        <CompleteInvestorSubtypeForm />
      </div>
    );
  }

  const data = await getInvestorDashboard(user);
  const kyc = KYC_COPY[data.kycStatus] ?? KYC_COPY.NOT_STARTED;
  const isFlipper = hasInvestorCapability(user, "FLIPPER");
  const isSyndicate = hasInvestorCapability(user, "SYNDICATE");

  return (
    <>
      <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
        <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">
              Investor workspace
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Build your next position.
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/70">
              Keep opportunities, expressions of interest and verification in one clear
              view.
            </p>
          </div>
          <span
            data-testid="subtype-badge"
            className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur"
          >
            {SUBTYPE_BADGE_COPY[user.investorType]}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Link
          href="/marketplace"
          className="group rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Explore
          </p>
          <p className="mt-2 font-semibold text-primary">
            Find new opportunities{" "}
            <span className="text-accent transition group-hover:translate-x-1 inline-block">
              →
            </span>
          </p>
          <p className="mt-1 text-sm text-muted">
            Browse approved distressed stock and project information.
          </p>
        </Link>
        <Link
          href="/investor/kyc"
          className="group rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Compliance
          </p>
          <p className="mt-2 font-semibold text-primary">
            Identity & verification{" "}
            <span className="text-accent transition group-hover:translate-x-1 inline-block">
              →
            </span>
          </p>
          <p className="mt-1 text-sm text-muted">
            View your status and submit documents.
          </p>
        </Link>
        <Link
          href={isSyndicate ? "/investor/syndicates" : "/investor/flip"}
          className="group rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Workspace
          </p>
          <p className="mt-2 font-semibold text-primary">
            Open your workspace{" "}
            <span className="text-accent transition group-hover:translate-x-1 inline-block">
              →
            </span>
          </p>
          <p className="mt-1 text-sm text-muted">Continue where you left off.</p>
        </Link>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-sm font-semibold text-primary">Your overview</p>
          <p className="mt-1 text-sm text-muted">
            Positions, opportunities and identity status.
          </p>
        </div>
      </div>

      <p
        data-testid="eoi-notice"
        className="mt-6 rounded-xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-muted"
      >
        Syndicate participation is currently <strong>expression-of-interest only</strong>
        {" — "}no funds are collected on-platform and no pledge here is a payment or a
        binding commitment.
      </p>

      <div
        data-testid="kyc-card"
        className={`mt-4 rounded-2xl border border-current/10 px-5 py-4 text-sm leading-relaxed ${kyc.tone}`}
      >
        {kyc.text}
      </div>

      {isSyndicate && (
        <>
          <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              value={formatPenceGBP(data.summary.committedGBP)}
              label="Committed intent"
              hint="Pledged, not paid"
            />
            <StatCard value={data.summary.projectCount} label="Syndicates" />
            <StatCard value={data.summary.pledgeCount} label="Pledges" />
            <StatCard value={data.savedCount} label="Saved properties" />
          </div>

          <PortalSection title="Your pledges">
            {data.pledges.length === 0 ? (
              <PortalEmpty>
                No expressions of interest yet. Open syndicates appear here once you have
                registered an interest in one.
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
                      <span
                        aria-hidden
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-pale"
                      >
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${p.project.fundedPct}%` }}
                        />
                      </span>
                      <span className="text-xs tabular-nums text-muted">
                        {p.project.fundedPct}% of{" "}
                        {formatPenceGBP(p.project.capitalTargetGBP)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PortalSection>
        </>
      )}

      {isFlipper && (
        <PortalSection title="Flipper Workspace Overview">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="rounded-2xl border border-line bg-white p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Property Acquisition
              </span>
              <p className="mt-2 text-base font-bold text-primary">
                Browse Refurb Inventory
              </p>
              <p className="mt-1 text-xs text-muted">
                Filter listings with disclosed defects and EPC ratings
              </p>
              <Link
                href="/marketplace"
                className="mt-4 inline-block text-xs font-semibold text-primary underline hover:text-accent"
              >
                Browse Marketplace &rarr;
              </Link>
            </div>

            <div className="rounded-2xl border border-line bg-white p-5 opacity-80">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Renovation Tracking
              </span>
              <p className="mt-2 text-base font-bold text-primary">Refurb Projects</p>
              <p className="mt-1 text-xs text-muted">
                Contractor milestone management (Coming soon)
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-white p-5 opacity-80">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Resale Exit
              </span>
              <p className="mt-2 text-base font-bold text-primary">Property Resale</p>
              <p className="mt-1 text-xs text-muted">
                Listing finished refurbishings for sale (Coming soon)
              </p>
            </div>
          </div>
        </PortalSection>
      )}

      <PortalSection
        title="Find stock"
        action={
          <Link
            href="/marketplace"
            className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
          >
            Browse the marketplace
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          Every listing carries its disclosed defects, EPC rating and the agent&apos;s
          approved project information.
        </p>
      </PortalSection>
      {/* Phase 6 (ADR-060): one designated sponsored slot; nothing renders without a live ad. */}
      <AdSlot slot="INVESTOR_DASHBOARD" />
    </>
  );
}
