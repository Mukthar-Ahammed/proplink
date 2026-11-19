import { SubscriptionBanner } from "@/components/billing/SubscriptionGate";
import { AdSlot } from "@/components/ads/AdSlot";
import Link from "next/link";
import { requirePageRole, hasInvestorCapability } from "@/lib/authz";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { getInvestorDashboard } from "@/services/syndicates/investorDashboard";
import { CompleteInvestorSubtypeForm } from "@/components/investor/CompleteInvestorSubtypeForm";
import {
  AlertIcon,
  ArrowIcon,
  ArrowLink,
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
    <div className="space-y-12">
      <SubscriptionBanner />
      {/* ------------------------------------------------ status + compliance
          The EOI statement comes before any figure that implies money
          (docs/CONTEXT.md §1; tests/e2e/portals.spec.ts). */}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div
          data-testid="kyc-card"
          className="flex flex-col rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconChip tone={kyc.tone}>{KYC_ICON[kyc.tone]}</IconChip>
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                  Identity check
                </p>
                <p className="mt-0.5 font-semibold text-primary">{kyc.title}</p>
              </div>
            </div>
            <StatusPill tone={kyc.tone}>{kyc.label}</StatusPill>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-body">{kyc.text}</p>

          <ol className="mt-5 grid grid-cols-3 gap-2 text-xs">
            <Step done label="Account created" />
            <Step
              done={data.kycStatus === "APPROVED"}
              current={data.kycStatus !== "APPROVED"}
              label="Identity check"
            />
            <Step label="Register interest" />
          </ol>

          <div className="mt-6 flex flex-1 items-end">
            <Link
              href="/investor/kyc"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent hover:text-accent"
            >
              {kyc.cta}
              <ArrowIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="relative isolate overflow-hidden rounded-3xl border border-accent/20 bg-pale/70 p-6 sm:p-7">
          <div
            aria-hidden
            className="absolute -top-16 -right-16 -z-10 h-48 w-48 rounded-full bg-intel/15 blur-3xl"
          />
          <div className="flex items-center gap-3">
            <IconChip>
              <ShieldIcon />
            </IconChip>
            <p className="font-semibold text-primary">How investing works here</p>
          </div>
          <p data-testid="eoi-notice" className="mt-4 text-sm leading-relaxed text-body">
            Syndicate participation is currently{" "}
            <strong className="text-primary">expression-of-interest only</strong>
            {" — "}no funds are collected on-platform and no pledge here is a payment or a
            binding commitment.
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-body">
            <li className="flex items-start gap-2.5">
              <ScaleIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              Agreements are prepared by the project Solicitor.
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              Funds move only through solicitor-managed bank accounts.
            </li>
          </ul>
        </div>
      </div>

      {/* ------------------------------------------------------ syndicates */}
      {isSyndicate && (
        <>
          <section className="space-y-5">
            <InvestorSectionTitle
              title="Your"
              tail="overview"
              description="Figures are expressions of interest — nothing here has been paid."
            />
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
          </section>

          <section className="space-y-5">
            <InvestorSectionTitle
              title="Your"
              tail="pledges"
              description="Each project you have registered an interest in, with its funding progress."
              action={
                data.pledges.length > 0 ? (
                  <ArrowLink href="/investor/syndicates">All syndicate deals</ArrowLink>
                ) : null
              }
            />
            {data.pledges.length === 0 ? (
              <InvestorEmpty
                title="No expressions of interest yet"
                action={
                  <PrimaryLink href="/marketplace">Browse the marketplace</PrimaryLink>
                }
              >
                Open syndicates appear here once you have registered an interest in one.
              </InvestorEmpty>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {data.pledges.map((p) => (
                  <PledgeCard key={p.id} pledge={p} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* --------------------------------------- legacy flipper (flag-gated) */}
      {isFlipper && (
        <section className="space-y-5">
          <InvestorSectionTitle title="Flipper" tail="workspace" />
          <div className="grid gap-4 sm:grid-cols-3">
            <QuickLink
              href="/marketplace"
              icon={<SearchIcon />}
              eyebrow="Property acquisition"
              title="Browse refurb inventory"
              body="Filter listings with disclosed defects and EPC ratings."
            />
            <div className="rounded-3xl border border-line bg-surface/70 p-6">
              <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                Renovation tracking
              </p>
              <p className="mt-2 font-semibold text-primary">Refurb projects</p>
              <p className="mt-1 text-sm text-muted">
                Contractor milestones — coming soon.
              </p>
            </div>
            <div className="rounded-3xl border border-line bg-surface/70 p-6">
              <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                Resale exit
              </p>
              <p className="mt-2 font-semibold text-primary">Property resale</p>
              <p className="mt-1 text-sm text-muted">
                List finished refurbishments — coming soon.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- shortcuts */}
      <section className="space-y-5">
        <InvestorSectionTitle title="Keep" tail="moving" />
        <div className="grid gap-4 md:grid-cols-3">
          <QuickLink
            href="/marketplace"
            icon={<SearchIcon />}
            eyebrow="Explore"
            title="Find new opportunities"
            body="Approved distressed stock with disclosed defects, EPC ratings and project information."
          />
          <QuickLink
            href="/investor/kyc"
            icon={<IdIcon />}
            eyebrow="Compliance"
            title="Identity & verification"
            body="See your status and complete your identity check."
          />
          <QuickLink
            href="/investor/profile"
            icon={<UserIcon />}
            eyebrow="Profile"
            title="Your investor profile"
            body="How Agents and other investors see you on PropLink."
          />
        </div>
      </section>

      {/* Phase 6 (ADR-060): one designated sponsored slot; nothing renders without a live ad. */}
      <AdSlot slot="INVESTOR_DASHBOARD" />
    </div>
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

function QuickLink({
  href,
  icon,
  eyebrow,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-3xl border border-line bg-white p-6 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-center justify-between">
        <IconChip>{icon}</IconChip>
        <ArrowIcon className="h-5 w-5 text-muted transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
      </div>
      <p className="mt-5 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {eyebrow}
      </p>
      <p className="mt-1 font-semibold text-primary">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
    </Link>
  );
}
