import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalSection } from "@/components/portal/PortalShell";
import {
  AgentProposalFeeType,
  AgentProposalStatus,
  Role,
} from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { formatPence, getMarketplaceListing } from "@/services/landlord/marketplace";

import {
  AnswerForm,
  ProposalForm,
  WithdrawProposal,
  type ProposalDefaults,
} from "./ProposalForms";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agent — Landlord listing",
  robots: { index: false },
};

const OUTCOME: Record<string, string> = {
  REFURBISHMENT: "Refurbishment",
  DEVELOPMENT_JV: "Development joint venture",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

const plainPounds = (pence: bigint | null) =>
  pence === null ? "" : (Number(pence) / 100).toFixed(2).replace(/\.00$/, "");

/** One approved private listing for a verified Agent, with their proposal. */
export default async function AgentMarketplaceListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const { id } = await params;
  const result = await getMarketplaceListing(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    id,
  );
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <PortalSection title="Landlord listing">
        <p className="text-sm text-body">{result.error}</p>
        <Link
          href="/agent/company"
          className="mt-3 inline-block text-sm font-semibold text-primary underline"
        >
          Check your company
        </Link>
      </PortalSection>
    );
  }
  const listing = result.data;
  const mine = listing.myProposal;
  const open =
    !mine ||
    mine.status === AgentProposalStatus.SUBMITTED ||
    mine.status === AgentProposalStatus.WITHDRAWN;
  const defaults: ProposalDefaults = {
    valuation: mine ? plainPounds(mine.valuationGBP) : "",
    feeType: mine?.feeType === AgentProposalFeeType.FIXED ? "FIXED" : "PERCENT",
    feePercent: mine?.feeBasisPoints ? String(mine.feeBasisPoints / 100) : "",
    feeAmount: mine ? plainPounds(mine.feeGBP) : "",
    contractMonths: mine ? String(mine.contractMonths) : "6",
    terms: mine?.terms ?? "",
    pitch: mine?.pitch ?? "",
  };

  return (
    <>
      <PortalSection
        title={listing.title}
        action={
          <Link
            href="/agent/marketplace"
            className="text-sm font-semibold text-primary underline"
          >
            All listings
          </Link>
        }
      >
        <p className="text-sm text-muted">
          Private listing, approved by PropLink. Do not share it outside PropLink. The
          landlord&apos;s identity and documents are shared only once they choose an
          agent.
        </p>
        {listing.photos.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {listing.photos.map((url, index) => (
              <li key={url}>
                {/* Signed, short-lived, access-checked link; not optimisable by next/image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Photo ${index + 1}`}
                  className="aspect-[4/3] w-full rounded-lg object-cover"
                />
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Row
            label="Address"
            value={[listing.addressLine1, listing.city, listing.postcode]
              .filter(Boolean)
              .join(", ")}
          />
          <Row
            label="Kind"
            value={[
              listing.propertyKind === "LAND" ? "Land" : "Property",
              listing.propertyType,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <Row
            label="Land area"
            value={listing.landAreaSqm ? `${listing.landAreaSqm} m²` : null}
          />
          <Row
            label="Landlord wants"
            value={listing.desiredOutcome ? OUTCOME[listing.desiredOutcome] : null}
          />
          <div className="sm:col-span-2">
            <Row label="Description" value={listing.description} />
          </div>
          <Row label="Known defects" value={listing.defects} />
          <Row label="Work required" value={listing.requiredWork} />
        </dl>
      </PortalSection>

      <PortalSection
        title={
          mine && mine.status !== AgentProposalStatus.WITHDRAWN
            ? "Your proposal"
            : "Send a proposal"
        }
      >
        {mine?.status === AgentProposalStatus.DECLINED && (
          <p className="text-sm text-body">The landlord declined your proposal.</p>
        )}
        {mine?.status === AgentProposalStatus.SELECTED && (
          <p className="text-sm text-success">The landlord chose you.</p>
        )}
        {mine && mine.status !== AgentProposalStatus.WITHDRAWN && (
          <p className="mb-4 text-sm text-muted">
            Valuation {formatPence(mine.valuationGBP)} · sent{" "}
            {mine.submittedAt.toISOString().slice(0, 10)}
          </p>
        )}
        {open && (
          <ProposalForm
            listingId={listing.id}
            defaults={defaults}
            editing={mine?.status === AgentProposalStatus.SUBMITTED}
          />
        )}
        {mine?.status === AgentProposalStatus.SUBMITTED && (
          <div className="mt-4">
            <WithdrawProposal listingId={listing.id} proposalId={mine.id} />
          </div>
        )}
      </PortalSection>

      {mine && mine.questions.length > 0 && (
        <PortalSection title="Landlord questions">
          <ul className="space-y-4">
            {mine.questions.map((question) => (
              <li
                key={question.id}
                className="rounded-lg border border-line bg-white p-4"
              >
                <p className="text-sm font-medium text-primary">{question.question}</p>
                {question.answer ? (
                  <p className="mt-2 text-sm text-body">Your answer: {question.answer}</p>
                ) : mine.status === AgentProposalStatus.SUBMITTED ? (
                  <AnswerForm listingId={listing.id} questionId={question.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </PortalSection>
      )}
    </>
  );
}
