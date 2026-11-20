import { AdSlot } from "@/components/ads/AdSlot";
import Link from "next/link";

import { KycStatus } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { VerifyButton } from "@/app/verify/VerifyButton";
import { Panel } from "@/components/portal/Detail";
import { getProviderApplicantState } from "@/services/kyc/providerVerification";
import { listOwnListings } from "@/services/landlord/listings";
import {
  AlertIcon,
  ArrowIcon,
  ArrowLink,
  ChartIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  FileIcon,
  HomeIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  PenIcon,
  PrimaryLink,
  ShieldIcon,
  StatStrip,
  StatusPill,
  UserIcon,
} from "@/components/investor/InvestorUi";

import { ListingCard } from "./listings/ListingCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Landlord portal — PropLink UK" };

type Tone = "success" | "warning" | "danger";

const KYC_COPY: Record<
  KycStatus,
  { tone: Tone; label: string; title: string; text: string }
> = {
  NOT_STARTED: {
    tone: "warning",
    label: "Not started",
    title: "Finish your identity check",
    text: "PropLink checks every landlord's identity before a listing goes to review. It takes a few minutes, and we keep only the result, not your documents.",
  },
  PENDING: {
    tone: "warning",
    label: "In review",
    title: "Verification in progress",
    text: "Your verification is in progress. You can write listings now and submit them once it's approved.",
  },
  APPROVED: {
    tone: "success",
    label: "Verified",
    title: "Identity verified",
    text: "You're verified. Any complete listing with an ownership document can go to PropLink review.",
  },
  REJECTED: {
    tone: "danger",
    label: "Needs attention",
    title: "Verification needs attention",
    text: "Your last verification wasn't approved. Please try again before submitting a listing.",
  },
};

const KYC_ICON: Record<Tone, React.ReactNode> = {
  success: <CheckIcon />,
  warning: <ClockIcon />,
  danger: <AlertIcon />,
};

/**
 * Landlord overview (Phase 2 Task 1, ADR-034; layout ADR-080). Business
 * journey: "Complete KYC → create the listing (with AI help) → save as draft →
 * Admin reviews in 30–60 minutes". What needs the landlord comes first, then
 * the figures, then their properties beside the journey and privacy notes.
 */
export default async function LandlordHomePage() {
  const { user } = await requirePageRole("LANDLORD");
  const [listings, provider] = await Promise.all([
    listOwnListings(user.authUserId),
    getProviderApplicantState(user.authUserId),
  ]);
  const kycStatus = user.kycStatus;
  const kyc = KYC_COPY[kycStatus] ?? KYC_COPY.NOT_STARTED;
  const verified = kycStatus === KycStatus.APPROVED;
  const canVerify =
    kycStatus === KycStatus.NOT_STARTED ||
    kycStatus === KycStatus.REJECTED ||
    (kycStatus === KycStatus.PENDING && provider.sameProvider);
  const count = (statuses: string[]) =>
    listings.filter((l) => statuses.includes(l.status)).length;
  const needsConfirmation = listings.filter(
    (l) => l.status === "AWAITING_LANDLORD_CONFIRMATION",
  );
  const hasSubmitted = listings.some((l) => l.submittedAt !== null);
  const hasAttention = !verified || needsConfirmation.length > 0;

  return (
    <div className="space-y-10">
      {/* ------------------------------------------- needs your attention */}
      {hasAttention && (
        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="sr-only">
            Next steps
          </h2>
          <Panel
            title="Needs your attention"
            description="Things waiting on you before your property can reach agents."
            tone="attention"
          >
            <ul className="divide-y divide-warning/20">
              {!verified && (
                <li
                  role="status"
                  data-testid="landlord-kyc"
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                    <div>
                      <p className="font-semibold text-primary">{kyc.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-body">
                        {kyc.text}
                      </p>
                    </div>
                  </div>
                  {canVerify && (
                    <div className="shrink-0">
                      <VerifyButton
                        label={
                          kycStatus === KycStatus.PENDING
                            ? "Continue verification"
                            : "Verify my identity"
                        }
                      />
                    </div>
                  )}
                </li>
              )}
              {needsConfirmation.length > 0 && (
                <li
                  role="status"
                  className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <PenIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold text-primary">
                      PropLink prepared{" "}
                      {needsConfirmation.length === 1 ? "a listing" : "listings"} for you
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-body">
                      Check the details and confirm before it goes to review:{" "}
                      {needsConfirmation.map((l, i) => (
                        <span key={l.id}>
                          {i > 0 ? ", " : ""}
                          <Link
                            href={`/landlord/listings/${l.id}`}
                            className="font-semibold text-accent underline underline-offset-4"
                          >
                            {l.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  </div>
                </li>
              )}
            </ul>
          </Panel>
        </section>
      )}

      {/* ------------------------------------------------------- overview */}
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Your"
          tail="overview"
          description="Where each of your properties is in the journey."
          action={
            <PrimaryLink href="/landlord/listings/new">List a property</PrimaryLink>
          }
        />
        <StatStrip
          items={[
            {
              value: count(["DRAFT", "REJECTED", "AWAITING_LANDLORD_CONFIRMATION"]),
              label: "To finish",
            },
            {
              value: count(["SUBMITTED"]),
              label: "In PropLink review",
              hint: "Usually 30–60 minutes",
            },
            { value: count(["APPROVED"]), label: "Visible to verified agents" },
            { value: listings.length, label: "Properties listed" },
          ]}
        />
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ------------------------------------------------- main column */}
        <div className="min-w-0 space-y-6">
          <Panel
            title="Your properties"
            description="Your most recently updated listings and where each one stands."
            action={
              listings.length > 0 ? (
                <ArrowLink href="/landlord/listings">View all</ArrowLink>
              ) : null
            }
          >
            {listings.length === 0 ? (
              <InvestorEmpty
                title="You haven't listed a property yet"
                action={
                  <PrimaryLink href="/landlord/listings/new">
                    List your first property
                  </PrimaryLink>
                }
              >
                Start with a title; it saves as a private draft you can finish at your own
                pace.
              </InvestorEmpty>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {listings.slice(0, 4).map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="After an agent is appointed"
            description="Once you accept an agent's proposal, the project they run with investors appears here."
          >
            <ul className="grid gap-3 sm:grid-cols-2">
              <TileLink
                href="/landlord/projects"
                icon={<ChartIcon />}
                title="Your projects"
                body="Funding, works and sale for properties your agent has taken to investors."
              />
              <TileLink
                href="/landlord/listings"
                icon={<FileIcon />}
                title="Proposals and mandates"
                body="Open a property to compare agents' proposals and manage the mandate."
              />
            </ul>
          </Panel>
        </div>

        {/* --------------------------------------------------- side rail */}
        <aside className="space-y-6">
          <section className="rounded-2xl border border-line bg-white p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <IconChip tone={kyc.tone}>{KYC_ICON[kyc.tone]}</IconChip>
                <div>
                  <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                    Your journey
                  </p>
                  <h3 className="mt-0.5 font-semibold text-primary">
                    {verified ? "Identity verified" : "Getting started"}
                  </h3>
                </div>
              </div>
              <StatusPill tone={kyc.tone}>{kyc.label}</StatusPill>
            </div>
            <ol className="mt-5 space-y-3 text-sm">
              <Step done label="Account created" />
              <Step done={verified} current={!verified} label="Identity check" />
              <Step
                done={hasSubmitted}
                current={verified && !hasSubmitted}
                label="List a property"
              />
              <Step done={count(["APPROVED"]) > 0} label="Agents see it" />
            </ol>
          </section>

          <section className="relative isolate overflow-hidden rounded-2xl border border-accent/20 bg-pale/70 p-5 sm:p-6">
            <div
              aria-hidden
              className="absolute -top-16 -right-16 -z-10 h-48 w-48 rounded-full bg-intel/15 blur-3xl"
            />
            <div className="flex items-center gap-3">
              <IconChip>
                <ShieldIcon />
              </IconChip>
              <h3 className="font-semibold text-primary">Private by design</h3>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-body">
              Your listings are <strong className="text-primary">never public</strong> and
              never appear in search. Landlords never pay to use PropLink.
            </p>
            <ul className="mt-4 space-y-2.5 text-sm text-body">
              <li className="flex items-start gap-2.5">
                <EyeIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                Only PropLink-verified agents see a listing, after our review.
              </li>
              <li className="flex items-start gap-2.5">
                <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                Files are scanned for malware and kept private.
              </li>
            </ul>
          </section>

          <Panel title="Shortcuts">
            <ul className="-my-1 divide-y divide-line text-sm">
              <RailLink href="/landlord/listings/new" icon={<HomeIcon />}>
                List a property
              </RailLink>
              <RailLink href="/landlord/listings" icon={<FileIcon />}>
                My properties
              </RailLink>
              <RailLink href="/account/profile" icon={<UserIcon />}>
                Your details
              </RailLink>
            </ul>
          </Panel>
        </aside>
      </div>

      {/* Phase 6 (ADR-060): one designated sponsored slot; nothing renders without a live ad. */}
      <AdSlot slot="LANDLORD_DASHBOARD" />
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
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
          done
            ? "bg-accent text-white"
            : current
              ? "bg-accent/15 text-accent ring-2 ring-accent/40"
              : "bg-surface ring-1 ring-line"
        }`}
      >
        {done ? <CheckIcon className="h-3.5 w-3.5" /> : null}
      </span>
      <span className={done || current ? "font-medium text-primary" : "text-muted"}>
        {label}
        {done ? <span className="sr-only"> (complete)</span> : null}
        {current ? <span className="sr-only"> (current step)</span> : null}
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
