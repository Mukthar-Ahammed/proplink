import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  IconChip,
  InvestorSectionTitle,
  ShieldIcon,
  StatusPill,
} from "@/components/investor/InvestorUi";
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
const PROPOSAL: Record<string, string> = {
  SUBMITTED: "Proposal sent",
  DECLINED: "Declined",
  SELECTED: "Chosen",
};
const PROPOSAL_TONE: Record<string, "accent" | "neutral" | "success"> = {
  SUBMITTED: "accent",
  DECLINED: "neutral",
  SELECTED: "success",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/agent/marketplace"
      className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
    >
      <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
      All listings
    </Link>
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
      <section className="space-y-5">
        <InvestorSectionTitle title="Landlord" tail="listing" />
        <div className="flex items-start gap-3 rounded-3xl border border-warning/25 bg-warning/5 p-5 sm:p-6">
          <IconChip tone="warning">
            <AlertIcon />
          </IconChip>
          <div className="min-w-0">
            <p className="text-sm leading-relaxed text-body">{result.error}</p>
            <Link
              href="/agent/company"
              className="group mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
            >
              Check your company
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>
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
  const sent = mine && mine.status !== AgentProposalStatus.WITHDRAWN;

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <div className="space-y-4">
          <BackLink />
          <InvestorSectionTitle title={listing.title} />
        </div>
        <p className="flex items-start gap-2.5 rounded-2xl border border-accent/20 bg-pale/60 p-4 text-sm leading-relaxed text-body">
          <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>
            Private listing, approved by PropLink. Do not share it outside PropLink. The
            landlord&apos;s identity and documents are shared only once they choose an
            agent.
          </span>
        </p>
        {listing.photos.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {listing.photos.map((url, index) => (
              <li
                key={url}
                className="overflow-hidden rounded-2xl border border-line bg-surface"
              >
                {/* Signed, short-lived, access-checked link; not optimisable by next/image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Photo ${index + 1}`}
                  className="aspect-[4/3] w-full object-cover"
                />
              </li>
            ))}
          </ul>
        )}
        <dl className="grid gap-x-8 gap-y-5 rounded-3xl border border-line bg-white p-6 shadow-sm sm:grid-cols-2 sm:p-7">
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
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle
          title={sent ? "Your" : "Send a"}
          tail="proposal"
          action={
            sent ? (
              <StatusPill tone={PROPOSAL_TONE[mine.status] ?? "neutral"}>
                {PROPOSAL[mine.status] ?? mine.status}
              </StatusPill>
            ) : undefined
          }
        />
        <div className="space-y-5 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7">
          {mine?.status === AgentProposalStatus.DECLINED && (
            <p className="text-sm text-body">The landlord declined your proposal.</p>
          )}
          {mine?.status === AgentProposalStatus.SELECTED && (
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <CheckIcon className="h-4 w-4" />
              The landlord chose you.
            </p>
          )}
          {sent && (
            <p className="text-sm text-muted">
              Valuation{" "}
              <span className="font-semibold text-primary tabular-nums">
                {formatPence(mine.valuationGBP)}
              </span>{" "}
              · sent {mine.submittedAt.toISOString().slice(0, 10)}
            </p>
          )}
          {open && (
            <div className={sent ? "border-t border-line pt-5" : undefined}>
              <ProposalForm
                listingId={listing.id}
                defaults={defaults}
                editing={mine?.status === AgentProposalStatus.SUBMITTED}
              />
            </div>
          )}
          {mine?.status === AgentProposalStatus.SUBMITTED && (
            <div className="border-t border-line pt-5">
              <WithdrawProposal listingId={listing.id} proposalId={mine.id} />
            </div>
          )}
        </div>
      </section>

      {mine && mine.questions.length > 0 && (
        <section className="space-y-5">
          <InvestorSectionTitle title="Landlord" tail="questions" />
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
            {mine.questions.map((question) => (
              <li key={question.id} className="space-y-2 p-5 sm:px-6">
                <p className="text-sm font-semibold text-primary">{question.question}</p>
                {question.answer ? (
                  <p className="rounded-2xl border border-line bg-surface/60 p-3 text-sm text-body">
                    Your answer: {question.answer}
                  </p>
                ) : mine.status === AgentProposalStatus.SUBMITTED ? (
                  <AnswerForm listingId={listing.id} questionId={question.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
