import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AlertIcon,
  ArrowIcon,
  IconChip,
  InvestorSectionTitle,
} from "@/components/investor/InvestorUi";
import {
  DetailHeader,
  DetailTabs,
  FactList,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { Badge } from "@/components/ui/badge";
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
const PROPOSAL_TONE: Record<string, "intel" | "default" | "success"> = {
  SUBMITTED: "intel",
  DECLINED: "default",
  SELECTED: "success",
};

const PRIMARY_LINK =
  "inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong";

const plainPounds = (pence: bigint | null) =>
  pence === null ? "" : (Number(pence) / 100).toFixed(2).replace(/\.00$/, "");

/**
 * One approved private listing for a verified Agent, with their proposal.
 * Tabs (ADR-080): The property · Your proposal · Landlord questions.
 */
export default async function AgentMarketplaceListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const [{ id }, query] = await Promise.all([params, searchParams]);
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
  const path = `/agent/marketplace/${listing.id}`;
  const questions = mine?.questions ?? [];
  const unanswered =
    mine?.status === AgentProposalStatus.SUBMITTED
      ? questions.filter((question) => !question.answer).length
      : 0;
  const kind = [
    listing.propertyKind === "LAND" ? "Land" : "Property",
    listing.propertyType,
  ]
    .filter(Boolean)
    .join(" · ");

  const tabs: DetailTab[] = [
    { key: "property", label: "The property" },
    {
      key: "proposal",
      label: sent ? "Your proposal" : "Send a proposal",
      attention: !sent,
    },
  ];
  if (questions.length > 0) {
    tabs.push({
      key: "questions",
      label: "Landlord questions",
      count: questions.length,
      attention: unanswered > 0,
    });
  }
  const tab = pickTab(query.tab, tabs);

  return (
    <>
      <DetailHeader
        back={{ href: "/agent/marketplace", label: "All listings" }}
        eyebrow="Private landlord listing"
        title={listing.title}
        badges={
          <>
            {sent ? (
              <Badge tone={PROPOSAL_TONE[mine.status] ?? "default"}>
                {PROPOSAL[mine.status] ?? mine.status}
              </Badge>
            ) : (
              <Badge tone="warning">No proposal sent</Badge>
            )}
            {unanswered > 0 ? (
              <Badge tone="warning">
                {unanswered} question{unanswered === 1 ? "" : "s"} to answer
              </Badge>
            ) : null}
          </>
        }
        subtitle="Private listing, approved by PropLink. Do not share it outside PropLink. The landlord's identity and documents are shared only once they choose an agent."
        actions={
          open && tab !== "proposal" ? (
            <Link href={`${path}?tab=proposal`} scroll={false} className={PRIMARY_LINK}>
              {sent ? "Edit proposal" : "Send a proposal"}
            </Link>
          ) : null
        }
      />

      <KeyFacts
        items={[
          {
            label: "Location",
            value: [listing.city, listing.postcode].filter(Boolean).join(", ") || "—",
          },
          { label: "Kind", value: kind },
          {
            label: "Land area",
            value: listing.landAreaSqm ? `${listing.landAreaSqm} m²` : "—",
          },
          {
            label: "Landlord wants",
            value: listing.desiredOutcome ? OUTCOME[listing.desiredOutcome] : "—",
          },
          {
            label: "Your valuation",
            value: sent ? formatPence(mine.valuationGBP) : "—",
            hint: sent
              ? `sent ${mine.submittedAt.toISOString().slice(0, 10)}`
              : undefined,
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Listing sections" />

      {tab === "property" && (
        <TabBody>
          {listing.photos.length > 0 && (
            <Panel title="Photos">
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
            </Panel>
          )}
          <Panel title="Property details">
            <FactList
              items={[
                {
                  label: "Address",
                  value: [listing.addressLine1, listing.city, listing.postcode]
                    .filter(Boolean)
                    .join(", "),
                },
                { label: "Kind", value: kind },
                {
                  label: "Land area",
                  value: listing.landAreaSqm ? `${listing.landAreaSqm} m²` : null,
                },
                {
                  label: "Landlord wants",
                  value: listing.desiredOutcome ? OUTCOME[listing.desiredOutcome] : null,
                },
                { label: "Description", value: listing.description, wide: true },
                { label: "Known defects", value: listing.defects },
                { label: "Work required", value: listing.requiredWork },
              ]}
            />
          </Panel>
        </TabBody>
      )}

      {tab === "proposal" && (
        <TabBody>
          <Panel
            title={sent ? "Your proposal" : "Send a proposal"}
            description={
              sent
                ? undefined
                : "Your valuation, fee and terms. The landlord compares proposals and chooses one agent."
            }
            tone={!sent ? "attention" : "default"}
          >
            <div className="space-y-5">
              {mine?.status === AgentProposalStatus.DECLINED && (
                <p className="text-sm text-body">The landlord declined your proposal.</p>
              )}
              {mine?.status === AgentProposalStatus.SELECTED && (
                <p className="text-sm font-semibold text-success">
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
          </Panel>
        </TabBody>
      )}

      {tab === "questions" && mine && (
        <TabBody>
          <Panel
            title="Landlord questions"
            description="Questions the landlord asked about your proposal."
            tone={unanswered > 0 ? "attention" : "default"}
          >
            <ul className="divide-y divide-line">
              {questions.map((question) => (
                <li key={question.id} className="space-y-2 py-4">
                  <p className="text-sm font-semibold text-primary">
                    {question.question}
                  </p>
                  {question.answer ? (
                    <p className="rounded-2xl border border-line bg-surface p-3 text-sm text-body">
                      Your answer: {question.answer}
                    </p>
                  ) : mine.status === AgentProposalStatus.SUBMITTED ? (
                    <AnswerForm listingId={listing.id} questionId={question.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </TabBody>
      )}
    </>
  );
}
