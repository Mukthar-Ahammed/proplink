import Link from "next/link";

import { KycStatus } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { VerifyButton } from "@/app/verify/VerifyButton";
import { getProviderApplicantState } from "@/services/kyc/providerVerification";
import { listOwnListings } from "@/services/landlord/listings";
import {
  AlertIcon,
  ArrowIcon,
  ArrowLink,
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

import { ListingCard } from "@/components/landlord/ListingCard";

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
 * Landlord overview (Phase 2 Task 1, ADR-034). Business journey: "Complete
 * KYC → create the listing (with AI help) → save as draft → Admin reviews in
 * 30–60 minutes". Interested agents and the mandate appear here with Tasks 5–6.
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

  return (
    <div className="space-y-12">
      {needsConfirmation.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-3xl border border-warning/30 bg-warning/5 p-5 sm:p-6"
        >
          <IconChip tone="warning">
            <PenIcon />
          </IconChip>
          <div>
            <p className="font-semibold text-primary">
              PropLink prepared{" "}
              {needsConfirmation.length === 1 ? "a listing" : "listings"} for you
            </p>
            <p className="mt-1 text-sm leading-relaxed text-body">
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
        </div>
      )}

      {/* ------------------------------------------------ status + privacy */}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div
          {...(!verified && { role: "status", "data-testid": "landlord-kyc" })}
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

          <ol className="mt-5 grid grid-cols-4 gap-2 text-xs">
            <Step done label="Account created" />
            <Step done={verified} current={!verified} label="Identity check" />
            <Step
              done={hasSubmitted}
              current={verified && !hasSubmitted}
              label="List a property"
            />
            <Step done={count(["APPROVED"]) > 0} label="Agents see it" />
          </ol>

          {canVerify && (
            <div className="mt-6 flex flex-1 items-end">
              <VerifyButton
                label={
                  kycStatus === KycStatus.PENDING
                    ? "Continue verification"
                    : "Verify my identity"
                }
              />
            </div>
          )}
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
            <p className="font-semibold text-primary">Private by design</p>
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
        </div>
      </div>

      {/* ------------------------------------------------------- overview */}
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Your"
          tail="overview"
          description="Where each of your properties is in the journey."
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

      {/* ----------------------------------------------------- properties */}
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Your"
          tail="properties"
          description="Your most recently updated listings."
          action={
            listings.length > 0 ? (
              <ArrowLink href="/landlord/listings">All properties</ArrowLink>
            ) : null
          }
        />
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
      </section>

      {/* ------------------------------------------------------ shortcuts */}
      <section className="space-y-5">
        <InvestorSectionTitle title="Keep" tail="moving" />
        <div className="grid gap-4 md:grid-cols-3">
          <QuickLink
            href="/landlord/listings/new"
            icon={<HomeIcon />}
            eyebrow="New listing"
            title="List a property"
            body="A house, flat, commercial building or development land, saved as a private draft."
          />
          <QuickLink
            href="/landlord/listings"
            icon={<FileIcon />}
            eyebrow="Your listings"
            title="My properties"
            body="Every listing, its review status and what's still needed to submit."
          />
          <QuickLink
            href="/account/profile"
            icon={<UserIcon />}
            eyebrow="Profile"
            title="Your details"
            body="Keep your name and contact details up to date for PropLink."
          />
        </div>
      </section>
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
