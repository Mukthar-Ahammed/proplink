import { SubscriptionBanner } from "@/components/billing/SubscriptionGate";
import { AdSlot } from "@/components/ads/AdSlot";
import Link from "next/link";
import { requirePageRole, hasInvestorCapability } from "@/lib/authz";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { getInvestorDashboard } from "@/services/syndicates/investorDashboard";
import { CompleteInvestorSubtypeForm } from "@/components/investor/CompleteInvestorSubtypeForm";
import { Panel } from "@/components/portal/Detail";
import {
  AlertIcon,
  ArrowIcon,
  ArrowLink,
  ChartIcon,
  CheckIcon,
  ClockIcon,
  IconChip,
  IdIcon,
  InvestorEmpty,
  InvestorSectionTitle,
  PledgeCard,
  PrimaryLink,
  ScaleIcon,
  SearchIcon,
  ShieldIcon,
  StatStrip,
  StatusPill,
  UserIcon,
} from "@/components/investor/InvestorUi";

export const dynamic = "force-dynamic";

type Tone = "success" | "warning" | "danger";

const KYC_COPY: Record<
  string,
  { tone: Tone; label: string; title: string; text: string; cta: string }
> = {
  NOT_STARTED: {
    tone: "warning",
    label: "Not started",
    title: "Verify your identity",
    text: "Identity verification is required before accessing protected financial actions, such as registering interest in a project.",
    cta: "Start verification",
  },
  PENDING: {
    tone: "warning",
    label: "In review",
    title: "Verification in progress",
    text: "Your identity verification is under review. We will update your status as soon as there is a result.",
    cta: "View status",
  },
  APPROVED: {
    tone: "success",
    label: "Verified",
    title: "Identity verified",
    text: "Your identity check is complete. Financial features will be unlocked as they become available.",
    cta: "View details",
  },
  REJECTED: {
    tone: "danger",
    label: "Needs attention",
    title: "Verification needs attention",
    text: "Your last identity verification was not approved. Review the notes and resubmit, or contact support.",
    cta: "Review and resubmit",
  },
};

const KYC_ICON: Record<Tone, React.ReactNode> = {
  success: <CheckIcon />,
  warning: <ClockIcon />,
  danger: <AlertIcon />,
};

/**
 * Investor overview (ADR-080 layout): what needs doing first, then the
 * figures, then the work grouped into titled panels with a side rail for the
 * identity check and shortcuts.
 */
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
  const kycOutstanding = data.kycStatus !== "APPROVED";

  return (
    <div className="space-y-10">
      <SubscriptionBanner />

      {/* ------------------------------------------- needs your attention */}
      {kycOutstanding && (
        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="sr-only">
            Next steps
          </h2>
          <Panel
            title="Needs your attention"
            description="Do this first: it unlocks pledging and project documents."
            tone="attention"
          >
            <ul className="divide-y divide-warning/20">
              <AttentionItem
                title={kyc.title}
                text={kyc.text}
                href="/investor/kyc"
                cta={kyc.cta}
              />
            </ul>
          </Panel>
        </section>
      )}

      {/* The EOI statement comes before any figure that implies money
          (docs/CONTEXT.md §1; tests/e2e/portals.spec.ts). */}
      <div className="flex flex-col gap-4 rounded-2xl border border-accent/20 bg-pale/70 p-5 sm:flex-row sm:items-start sm:p-6">
        <IconChip>
          <ShieldIcon />
        </IconChip>
        <div className="min-w-0">
          <p className="font-semibold text-primary">How investing works here</p>
          <p data-testid="eoi-notice" className="mt-1 text-sm leading-relaxed text-body">
            Syndicate participation is currently{" "}
            <strong className="text-primary">expression-of-interest only</strong>
            {" — "}no funds are collected on-platform and no pledge here is a payment or a
            binding commitment.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-body">
            <li className="flex items-center gap-2">
              <ScaleIcon className="h-4 w-4 shrink-0 text-accent" />
              Agreements are prepared by the project Solicitor.
            </li>
            <li className="flex items-center gap-2">
              <ShieldIcon className="h-4 w-4 shrink-0 text-accent" />
              Funds move only through solicitor-managed bank accounts.
            </li>
          </ul>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ------------------------------------------------- main column */}
        <div className="min-w-0 space-y-6">
          <InvestorSectionTitle
            title="Your"
            tail="investments"
            description={
              isSyndicate
                ? "Figures are expressions of interest — nothing here has been paid."
                : "Projects and properties you are following."
            }
            action={<ArrowLink href="/investor/projects">Browse projects</ArrowLink>}
          />

          {isSyndicate && (
            <>
              <StatStrip
                items={[
                  {
                    value: formatPenceGBP(data.summary.committedGBP),
                    label: "Committed intent",
                    hint: "Pledged, not paid",
                  },
                  { value: data.summary.projectCount, label: "Syndicates" },
                  { value: data.summary.pledgeCount, label: "Pledges" },
                  { value: data.savedCount, label: "Saved properties" },
                ]}
              />

              <Panel
                title="Your pledges"
                description="Each project you have registered an interest in, with its funding progress."
                action={
                  data.pledges.length > 0 ? (
                    <ArrowLink href="/investor/syndicates">View all</ArrowLink>
                  ) : null
                }
              >
                {data.pledges.length === 0 ? (
                  <InvestorEmpty
                    title="No expressions of interest yet"
                    action={
                      <PrimaryLink href="/investor/projects">
                        Browse investor projects
                      </PrimaryLink>
                    }
                  >
                    Projects you pledge to appear here with their funding progress.
                  </InvestorEmpty>
                ) : (
                  <ul className="grid gap-4 md:grid-cols-2">
                    {data.pledges.map((p) => (
                      <PledgeCard key={p.id} pledge={p} />
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}

          <Panel
            title="Find opportunities"
            description="Two places to look: projects agents have opened to investors, and the public marketplace."
          >
            <ul className="grid gap-3 sm:grid-cols-2">
              <TileLink
                href="/investor/projects"
                icon={<ChartIcon />}
                title="Investor projects"
                body="Refurbishment and development projects looking for a Lead and co-investors."
              />
              <TileLink
                href="/marketplace"
                icon={<SearchIcon />}
                title="Marketplace"
                body="Approved distressed stock with disclosed defects and EPC ratings."
              />
            </ul>
          </Panel>

          {/* ------------------------------- legacy flipper (flag-gated) */}
          {isFlipper && (
            <Panel
              title="Flipper workspace"
              description="Buy, refurbish and resell a property yourself."
            >
              <ul className="grid gap-3 sm:grid-cols-3">
                <TileLink
                  href="/marketplace"
                  icon={<SearchIcon />}
                  title="Browse refurb inventory"
                  body="Filter listings with disclosed defects and EPC ratings."
                />
                <li className="rounded-xl border border-line bg-surface/70 p-4">
                  <p className="font-semibold text-primary">Refurb projects</p>
                  <p className="mt-1 text-sm text-muted">
                    Contractor milestones — coming soon.
                  </p>
                </li>
                <li className="rounded-xl border border-line bg-surface/70 p-4">
                  <p className="font-semibold text-primary">Property resale</p>
                  <p className="mt-1 text-sm text-muted">
                    List finished refurbishments — coming soon.
                  </p>
                </li>
              </ul>
            </Panel>
          )}
        </div>

        {/* --------------------------------------------------- side rail */}
        <aside className="space-y-6">
          <div
            data-testid="kyc-card"
            className="rounded-2xl border border-line bg-white p-5 sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <IconChip tone={kyc.tone}>{KYC_ICON[kyc.tone]}</IconChip>
                <div>
                  <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                    Identity check
                  </p>
                  <h3 className="mt-0.5 font-semibold text-primary">{kyc.title}</h3>
                </div>
              </div>
              <StatusPill tone={kyc.tone}>{kyc.label}</StatusPill>
            </div>
            <ol className="mt-5 grid grid-cols-3 gap-2 text-xs">
              <Step done label="Account created" />
              <Step
                done={data.kycStatus === "APPROVED"}
                current={data.kycStatus !== "APPROVED"}
                label="Identity check"
              />
              <Step label="Register interest" />
            </ol>
            <div className="mt-5">
              <ArrowLink href="/investor/kyc">{kyc.cta}</ArrowLink>
            </div>
          </div>

          <Panel title="Your account" description="Shortcuts to the rest of your portal.">
            <ul className="-my-1 divide-y divide-line text-sm">
              <RailLink href="/investor/projects" icon={<ChartIcon />}>
                Investor projects
              </RailLink>
              {isSyndicate && (
                <RailLink href="/investor/syndicates" icon={<ScaleIcon />}>
                  Syndicate deals
                </RailLink>
              )}
              <RailLink href="/investor/kyc" icon={<IdIcon />}>
                Identity & verification
              </RailLink>
              <RailLink href="/investor/profile" icon={<UserIcon />}>
                Your investor profile
              </RailLink>
            </ul>
          </Panel>
        </aside>
      </div>

      {/* Phase 6 (ADR-060): one designated sponsored slot; nothing renders without a live ad. */}
      <AdSlot slot="INVESTOR_DASHBOARD" />
    </div>
  );
}

function AttentionItem({
  title,
  text,
  href,
  cta,
}: {
  title: string;
  text: string;
  href: string;
  cta: string;
}) {
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div>
          <p className="font-semibold text-primary">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-body">{text}</p>
        </div>
      </div>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong sm:self-auto"
      >
        {cta}
        <ArrowIcon className="h-4 w-4" />
      </Link>
    </li>
  );
}

function Step({
  label,
  done = false,
  current = false,
}: {
  label: string;
  done?: boolean;
  current?: boolean;
}) {
  return (
    <li className="flex flex-col gap-2">
      <span
        aria-hidden
        className={`h-1.5 rounded-full ${
          done
            ? "bg-accent"
            : current
              ? "bg-accent/35"
              : "bg-surface ring-1 ring-line ring-inset"
        }`}
      />
      <span className={done || current ? "font-medium text-primary" : "text-muted"}>
        {label}
        {done ? <span className="sr-only"> (complete)</span> : null}
      </span>
    </li>
  );
}

function TileLink({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex h-full items-start gap-3 rounded-xl border border-line bg-white p-4 transition hover:border-accent/40 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <IconChip>{icon}</IconChip>
        <span className="min-w-0">
          <span className="flex items-center gap-1 font-semibold text-primary group-hover:text-accent">
            {title}
            <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-muted">{body}</span>
        </span>
      </Link>
    </li>
  );
}

function RailLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 py-3 font-medium text-primary hover:text-accent"
      >
        <span className="text-accent [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <span className="flex-1">{children}</span>
        <ArrowIcon className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
      </Link>
    </li>
  );
}
