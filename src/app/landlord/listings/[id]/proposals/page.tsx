import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalSection } from "@/components/portal/PortalShell";
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

import { AskQuestion, DeclineProposal } from "./ProposalControls";

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
  const result = await listProposalsForOwner(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
      kycStatus: session.user.kycStatus,
    },
    id,
  );
  if (!result) notFound();
  const { listing, proposals } = result;
  const open = proposals.filter(
    (proposal) => proposal.status === AgentProposalStatus.SUBMITTED,
  );

  return (
    <>
      <PortalSection
        title={`Proposals for ${listing.title}`}
        action={
          <Link
            href={`/landlord/listings/${listing.id}`}
            className="text-sm font-semibold text-primary underline"
          >
            Back to the listing
          </Link>
        }
      >
        {proposals.length === 0 ? (
          <p className="text-sm text-muted">
            {listing.status === "APPROVED"
              ? "No proposals yet. Verified agents can now see your property; we will email you when one arrives."
              : "Agents can send proposals once PropLink approves your listing."}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {open.length} open {open.length === 1 ? "proposal" : "proposals"}. Compare
              them, ask questions, then choose one agent. Choosing an agent (an exclusive
              mandate) comes next.
            </p>
            <div className="mt-6 overflow-x-auto">
              <table
                className="w-full min-w-[640px] text-left text-sm"
                aria-label="Proposals side by side"
              >
                <thead>
                  <tr className="align-top">
                    <th
                      scope="row"
                      className="w-36 py-2 pr-4 text-xs tracking-wide text-muted uppercase"
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
                          className="py-2 pr-4 font-semibold text-primary"
                        >
                          <span className="flex items-center gap-1">
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
                          <span className="mt-1 block text-xs font-normal text-muted">
                            {STATUS[proposal.status]}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
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
                    <tr key={label} className="border-t border-line align-top">
                      <th
                        scope="row"
                        className="py-3 pr-4 text-xs tracking-wide text-muted uppercase"
                      >
                        {label}
                      </th>
                      {proposals.map((proposal) => (
                        <td
                          key={proposal.id}
                          className="py-3 pr-4 whitespace-pre-line text-body"
                        >
                          {value(proposal)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-line align-top">
                    <th
                      scope="row"
                      className="py-3 pr-4 text-xs tracking-wide text-muted uppercase"
                    >
                      Questions
                    </th>
                    {proposals.map((proposal) => (
                      <td key={proposal.id} className="space-y-3 py-3 pr-4">
                        {proposal.questions.map((question) => (
                          <div key={question.id}>
                            <p className="font-medium text-primary">
                              {question.question}
                            </p>
                            <p className="text-body">
                              {question.answer ?? (
                                <span className="text-muted">Waiting for an answer</span>
                              )}
                            </p>
                          </div>
                        ))}
                        {proposal.status === AgentProposalStatus.SUBMITTED && (
                          <>
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
          </>
        )}
      </PortalSection>
    </>
  );
}
