import Link from "next/link";

import { KycStatus } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { PortalEmpty, PortalSection, StatCard } from "@/components/portal/PortalShell";
import { VerifyButton } from "@/app/verify/VerifyButton";
import { getProviderApplicantState } from "@/services/kyc/providerVerification";
import { listOwnListings } from "@/services/landlord/listings";

import { formatDate, STATUS_LABEL, STATUS_TONE } from "./listings/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Landlord portal — PropLink UK" };

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
  const kyc = user.kycStatus;
  const canVerify =
    kyc === KycStatus.NOT_STARTED ||
    kyc === KycStatus.REJECTED ||
    (kyc === KycStatus.PENDING && provider.sameProvider);
  const count = (statuses: string[]) =>
    listings.filter((l) => statuses.includes(l.status)).length;
  const needsConfirmation = listings.filter(
    (l) => l.status === "AWAITING_LANDLORD_CONFIRMATION",
  );

  return (
    <>
      {kyc !== KycStatus.APPROVED && (
        <div
          role="status"
          data-testid="landlord-kyc"
          className="mb-8 rounded-lg border border-warning/40 bg-warning/10 p-4"
        >
          <p className="text-sm font-semibold text-primary">Finish your identity check</p>
          <p className="mt-1 text-sm text-muted">
            {kyc === KycStatus.PENDING
              ? "Your verification is in progress. You can write listings now and submit them once it's approved."
              : kyc === KycStatus.REJECTED
                ? "Your last verification wasn't approved. Please try again before submitting a listing."
                : "PropLink checks every landlord's identity before a listing goes to review. It takes a few minutes, and we keep only the result, not your documents."}
          </p>
          {canVerify && (
            <div className="mt-3">
              <VerifyButton
                label={
                  kyc === KycStatus.PENDING
                    ? "Continue verification"
                    : "Verify my identity"
                }
              />
            </div>
          )}
        </div>
      )}

      {needsConfirmation.length > 0 && (
        <div role="status" className="mb-8 rounded-lg border border-line bg-white p-4">
          <p className="text-sm font-semibold text-primary">
            PropLink prepared {needsConfirmation.length === 1 ? "a listing" : "listings"}{" "}
            for you
          </p>
          <p className="mt-1 text-sm text-muted">
            Check the details and confirm before it goes to review:{" "}
            {needsConfirmation.map((l, i) => (
              <span key={l.id}>
                {i > 0 ? ", " : ""}
                <Link
                  href={`/landlord/listings/${l.id}`}
                  className="text-accent underline"
                >
                  {l.title}
                </Link>
              </span>
            ))}
          </p>
        </div>
      )}

      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-3">
        <StatCard
          value={count(["DRAFT", "REJECTED", "AWAITING_LANDLORD_CONFIRMATION"])}
          label="To finish"
        />
        <StatCard
          value={count(["SUBMITTED"])}
          label="In PropLink review"
          hint="Usually 30–60 minutes"
        />
        <StatCard value={count(["APPROVED"])} label="Visible to verified agents" />
      </div>

      <PortalSection
        title="Your properties"
        action={
          <Link
            href="/landlord/listings/new"
            className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
          >
            List a property
          </Link>
        }
      >
        {listings.length === 0 ? (
          <PortalEmpty>
            You haven&apos;t listed a property yet.{" "}
            <Link
              href="/landlord/listings/new"
              className="font-semibold text-accent underline"
            >
              List your first property
            </Link>
          </PortalEmpty>
        ) : (
          <ul className="border-t border-line">
            {listings.slice(0, 5).map((listing) => (
              <li
                key={listing.id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4"
              >
                <Link
                  href={`/landlord/listings/${listing.id}`}
                  className="font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
                >
                  {listing.title}
                </Link>
                <span className="flex items-center gap-3 text-xs text-muted">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${STATUS_TONE[listing.status]}`}
                  >
                    {STATUS_LABEL[listing.status]}
                  </span>
                  Updated {formatDate(listing.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
    </>
  );
}
