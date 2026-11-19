import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArrowIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { VerifiedBadge } from "@/components/profiles/VerifiedBadge";
import { AgentProposalStatus, Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import {
  companyStatusPasses,
  effectiveCompanyStatus,
} from "@/services/agents/companyGate";
import {
  formatFee,
  formatPence,
  listProposalsForOwner,
} from "@/services/landlord/marketplace";

import { ContractUploader } from "@/components/mandates/ContractUploader";
import { DISCLOSURE_FIELDS } from "@/services/landlord/disclosure";
import { mandatesForOwner } from "@/services/landlord/mandates";

import { attachMandateContractAction } from "../../actions";
import { ChooseAgent, LandlordMandateControls } from "./MandateControls";
import { AskQuestion, DeclineProposal } from "./ProposalControls";

const MANDATE_STATUS: Record<string, string> = {
  OFFERED: "Offered, waiting for the agent",
  ACTIVE: "Active",
  DECLINED: "Declined by the agent",
  WITHDRAWN: "Offer withdrawn",
  TERMINATED: "Terminated",
  CLOSED: "Closed",
};
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "—");

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agent proposals — PropLink UK",
  robots: { index: false },
};

const STATUS: Record<string, string> = {
  SUBMITTED: "Open",
  DECLINED: "Declined",
  SELECTED: "Chosen",
};
const STATUS_TONE: Record<string, "accent" | "neutral" | "success"> = {
  SUBMITTED: "accent",
  DECLINED: "neutral",
  SELECTED: "success",
};

/**
 * Side-by-side comparison of Agent proposals on the Landlord's own listing
 * (Phase 2 Task 5, ADR-038; business Q7). Choosing an Agent is the mandate
 * step (Task 6).
 */
export default async function ListingProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.LANDLORD);
  const { id } = await params;
  const actor = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
    kycStatus: session.user.kycStatus,
  };
  const [result, mandates] = await Promise.all([
    listProposalsForOwner(actor, id),
    mandatesForOwner(actor, id),
  ]);
  if (!result || !mandates) notFound();
  const { listing, proposals } = result;
  const open = proposals.filter(
    (proposal) => proposal.status === AgentProposalStatus.SUBMITTED,
  );
  const live = mandates.live;
  const canChoose = !live && listing.status === "APPROVED";

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Link
          href={`/landlord/listings/${listing.id}`}
          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
        >
          <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
          Back to the listing
        </Link>
        <InvestorSectionTitle
          title="Proposals for"
          tail={listing.title}
          description="Compare agents side by side, ask questions, then choose one agent for an exclusive mandate."
        />
      </div>

      {(live || mandates.history.length > 0) && (
        <section className="space-y-5">
          <InvestorSectionTitle title="Exclusive" tail="mandate" />
          {live ? (
            <div className="space-y-4 rounded-3xl border border-line bg-white p-6 text-sm shadow-sm sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <IconChip tone={live.status === "ACTIVE" ? "success" : "warning"}>
                    {live.status === "ACTIVE" ? <CheckIcon /> : <ClockIcon />}
                  </IconChip>
                  <p className="font-semibold text-primary" data-testid="mandate-status">
                    {live.agent.name ?? "Your agent"}: {MANDATE_STATUS[live.status]}
                  </p>
                </div>
                <StatusPill tone={live.status === "ACTIVE" ? "success" : "warning"}>
                  {live.status === "ACTIVE" ? "Active" : "Waiting for the agent"}
                </StatusPill>
              </div>
              <dl className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted">Valuation</dt>
                  <dd className="mt-0.5 font-semibold text-primary tabular-nums">
                    {formatPence(live.valuationGBP)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Fee</dt>
                  <dd className="mt-0.5 font-semibold text-primary">{formatFee(live)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Contract</dt>
                  <dd className="mt-0.5 font-semibold text-primary">
                    {live.contractMonths} months
                  </dd>
                </div>
              </dl>
              {live.status === "ACTIVE" && (
                <p className="text-body">
                  Accepted {day(live.acceptedAt)} · contract ends {day(live.endsAt)}
                </p>
              )}
              {live.renewalTerms && (
                <p className="text-body">Renewal: {live.renewalTerms}</p>
              )}
              {live.status === "ACTIVE" && mandates.disclosure && (
                <p
                  className="rounded-2xl border border-accent/20 bg-pale/60 p-4 leading-relaxed text-body"
                  data-testid="landlord-disclosure"
                >
                  Your agent will show investors:{" "}
                  {DISCLOSURE_FIELDS.filter((field) => mandates.disclosure![field.key])
                    .map((field) => field.label.toLowerCase())
                    .join(", ") || "only the town and postcode district"}
                  . Your contact details and ownership documents are never shown.
                </p>
              )}
              {live.status === "ACTIVE" && (
                <div className="space-y-3">
                  {mandates.contractUrl && (
                    <a
                      href={mandates.contractUrl}
                      className="inline-flex items-center gap-1.5 font-semibold text-accent hover:text-accent-strong"
                    >
                      <FileIcon className="h-4 w-4" />
                      Signed contract
                    </a>
                  )}
                  <ContractUploader
                    mandateId={live.id}
                    attach={attachMandateContractAction}
                    hasContract={Boolean(mandates.contractUrl)}
                  />
                </div>
              )}
              <div className="border-t border-line pt-4">
                <LandlordMandateControls
                  listingId={listing.id}
                  mandateId={live.id}
                  status={live.status as "OFFERED" | "ACTIVE"}
                  contractEnded={Boolean(live.endsAt && live.endsAt <= new Date())}
                />
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-6 text-center text-sm text-muted">
              No agent holds a mandate now; you can choose another proposal below.
            </p>
          )}
          {mandates.history.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white text-sm">
              {mandates.history.map((mandate) => (
                <li key={mandate.id} className="px-5 py-3 text-muted">
                  <span className="font-semibold text-primary">
                    {mandate.agent.name ?? "Agent"}
                  </span>
                  : {MANDATE_STATUS[mandate.status]} (offered {day(mandate.offeredAt)})
                  {mandate.terminationReason && ` · reason: ${mandate.terminationReason}`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="space-y-5">
        <InvestorSectionTitle
          title="Agent"
          tail="proposals"
          description={
            proposals.length === 0
              ? undefined
              : `${open.length} open ${open.length === 1 ? "proposal" : "proposals"}.`
          }
        />
        {proposals.length === 0 ? (
          <InvestorEmpty title="No proposals yet">
            {listing.status === "APPROVED"
              ? "Verified agents can now see your property; we will email you when one arrives."
              : "Agents can send proposals once PropLink approves your listing."}
          </InvestorEmpty>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table
                className="w-full min-w-[640px] text-left text-sm"
                aria-label="Proposals side by side"
              >
                <thead className="border-b border-line bg-surface/70">
                  <tr className="align-top">
                    <th
                      scope="row"
                      className="w-36 px-5 py-4 text-xs font-semibold tracking-[0.1em] text-muted uppercase"
                    >
                      Agent
                    </th>
                    {proposals.map((proposal) => {
                      const company = proposal.agent.companyCheck;
                      const verified = companyStatusPasses(
                        effectiveCompanyStatus(company),
                      );
                      const agency = proposal.agent.legacyUser?.agentProfiles[0];
                      return (
                        <th
                          key={proposal.id}
                          scope="col"
                          className="px-5 py-4 font-semibold text-primary"
                        >
                          <span className="flex items-center gap-1.5">
                            {proposal.agent.name ?? "Agent"}
                            {proposal.agent.verificationBadge && <VerifiedBadge />}
                          </span>
                          {agency && (
                            <span className="block text-xs font-normal text-muted">
                              {agency.agencyName}
                            </span>
                          )}
                          {company && (
                            <span className="block text-xs font-normal text-muted">
                              {company.companyName} ({company.companyNumber})
                              {verified ? " · verified" : ""}
                            </span>
                          )}
                          <span className="mt-2 block">
                            <StatusPill tone={STATUS_TONE[proposal.status] ?? "neutral"}>
                              {STATUS[proposal.status]}
                            </StatusPill>
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(
                    [
                      ["Valuation", (p) => formatPence(p.valuationGBP)],
                      ["Fee", (p) => formatFee(p)],
                      [
                        "Contract",
                        (p) =>
                          `${p.contractMonths} ${p.contractMonths === 1 ? "month" : "months"}`,
                      ],
                      ["Proposed terms", (p) => p.terms],
                      ["Pitch", (p) => p.pitch],
                      ["Sent", (p) => p.submittedAt.toISOString().slice(0, 10)],
                    ] as const satisfies readonly (readonly [
                      string,
                      (p: (typeof proposals)[number]) => string,
                    ])[]
                  ).map(([label, value]) => (
                    <tr key={label} className="align-top">
                      <th
                        scope="row"
                        className="px-5 py-4 text-xs font-semibold tracking-[0.1em] text-muted uppercase"
                      >
                        {label}
                      </th>
                      {proposals.map((proposal) => (
                        <td
                          key={proposal.id}
                          className={`px-5 py-4 whitespace-pre-line ${
                            label === "Valuation"
                              ? "font-semibold text-primary tabular-nums"
                              : "text-body"
                          }`}
                        >
                          {value(proposal)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="align-top">
                    <th
                      scope="row"
                      className="px-5 py-4 text-xs font-semibold tracking-[0.1em] text-muted uppercase"
                    >
                      Questions
                    </th>
                    {proposals.map((proposal) => (
                      <td key={proposal.id} className="space-y-4 px-5 py-4">
                        {proposal.questions.map((question) => (
                          <div
                            key={question.id}
                            className="rounded-2xl border border-line bg-surface/60 p-3"
                          >
                            <p className="font-medium text-primary">
                              {question.question}
                            </p>
                            <p className="mt-1 text-body">
                              {question.answer ?? (
                                <span className="text-muted">Waiting for an answer</span>
                              )}
                            </p>
                          </div>
                        ))}
                        {proposal.status === AgentProposalStatus.SUBMITTED && (
                          <>
                            {canChoose && (
                              <ChooseAgent
                                listingId={listing.id}
                                proposalId={proposal.id}
                                agentName={proposal.agent.name ?? "this agent"}
                              />
                            )}
                            <AskQuestion
                              listingId={listing.id}
                              proposalId={proposal.id}
                            />
                            <DeclineProposal
                              listingId={listing.id}
                              proposalId={proposal.id}
                            />
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
