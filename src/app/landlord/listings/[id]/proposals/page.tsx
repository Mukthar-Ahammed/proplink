import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CheckIcon,
  ClockIcon,
  FileIcon,
  IconChip,
  InvestorEmpty,
  StatusPill,
} from "@/components/investor/InvestorUi";
import {
  DetailColumns,
  DetailHeader,
  DetailTabs,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { isVerified, PersonName } from "@/components/profiles/PersonName";
import { Badge } from "@/components/ui/badge";
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

type Proposals = NonNullable<
  Awaited<ReturnType<typeof listProposalsForOwner>>
>["proposals"];

/**
 * Side-by-side comparison of Agent proposals on the Landlord's own listing
 * (Phase 2 Task 5, ADR-038; business Q7), split into tabs (ADR-080):
 * Your agent · Compare proposals · Declined & past. Choosing an Agent is the
 * mandate step (Task 6).
 */
export default async function ListingProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requirePageRole(Role.LANDLORD);
  const [{ id }, query] = await Promise.all([params, searchParams]);
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
  const closed = proposals.filter(
    (proposal) => proposal.status !== AgentProposalStatus.SUBMITTED,
  );
  const live = mandates.live;
  const canChoose = !live && listing.status === "APPROVED";
  const path = `/landlord/listings/${listing.id}/proposals`;
  const highest = proposals.reduce<(typeof proposals)[number] | null>(
    (best, proposal) =>
      !best || proposal.valuationGBP > best.valuationGBP ? proposal : best,
    null,
  );

  const compareTab: DetailTab = {
    key: "compare",
    label: "Compare proposals",
    count: open.length,
    // Open proposals wait on the Landlord to choose, ask or decline.
    attention: canChoose && open.length > 0,
  };
  const tabs: DetailTab[] = [];
  if (live || mandates.history.length > 0) {
    const agentTab: DetailTab = { key: "agent", label: "Your agent" };
    // With an agent in place, that is what the Landlord comes here for.
    if (live) tabs.push(agentTab, compareTab);
    else tabs.push(compareTab, agentTab);
  } else {
    tabs.push(compareTab);
  }
  if (closed.length > 0) {
    tabs.push({ key: "past", label: "Declined & chosen", count: closed.length });
  }
  const tab = pickTab(query.tab, tabs);

  return (
    <div>
      <DetailHeader
        back={{ href: `/landlord/listings/${listing.id}`, label: "Back to the listing" }}
        eyebrow="Agent proposals"
        title={listing.title}
        badges={
          live ? (
            <Badge tone={live.status === "ACTIVE" ? "success" : "warning"}>
              {live.status === "ACTIVE"
                ? `Agent chosen: ${live.agent.name ?? "your agent"}`
                : "Waiting for the agent to accept"}
            </Badge>
          ) : canChoose ? (
            <Badge tone="intel">Choose one agent</Badge>
          ) : null
        }
        subtitle="Compare agents side by side, ask questions, then choose one agent for an exclusive mandate."
      />

      <KeyFacts
        items={[
          { label: "Proposals received", value: proposals.length },
          { label: "Open", value: open.length, hint: "Waiting for your decision" },
          {
            label: "Highest valuation",
            value: highest ? formatPence(highest.valuationGBP) : "—",
            hint: highest ? (highest.agent.name ?? "Agent") : undefined,
          },
          {
            label: "Your agent",
            value: live ? (live.agent.name ?? "Your agent") : "Not chosen yet",
            hint: live ? MANDATE_STATUS[live.status] : undefined,
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Proposal sections" />

      {tab === "agent" && (
        <TabBody>
          <DetailColumns
            main={
              live ? (
                <Panel
                  title="Exclusive mandate"
                  action={
                    <StatusPill tone={live.status === "ACTIVE" ? "success" : "warning"}>
                      {live.status === "ACTIVE" ? "Active" : "Waiting for the agent"}
                    </StatusPill>
                  }
                >
                  <div className="space-y-4 text-sm">
                    <div className="flex items-center gap-3">
                      <IconChip tone={live.status === "ACTIVE" ? "success" : "warning"}>
                        {live.status === "ACTIVE" ? <CheckIcon /> : <ClockIcon />}
                      </IconChip>
                      <p
                        className="font-semibold text-primary"
                        data-testid="mandate-status"
                      >
                        <PersonName
                          name={live.agent.name ?? "Your agent"}
                          verified={isVerified(live.agent)}
                        />
                        : {MANDATE_STATUS[live.status]}
                      </p>
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
                        <dd className="mt-0.5 font-semibold text-primary">
                          {formatFee(live)}
                        </dd>
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
                        {DISCLOSURE_FIELDS.filter(
                          (field) => mandates.disclosure![field.key],
                        )
                          .map((field) => field.label.toLowerCase())
                          .join(", ") || "only the town and postcode district"}
                        . Your contact details and ownership documents are never shown.
                      </p>
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
                </Panel>
              ) : (
                <Panel title="Exclusive mandate" tone="muted">
                  <p className="text-sm text-muted">
                    No agent holds a mandate now; you can choose another proposal on the{" "}
                    <Link
                      href={`${path}?tab=compare`}
                      scroll={false}
                      className="font-semibold text-accent underline"
                    >
                      Compare proposals
                    </Link>{" "}
                    tab.
                  </p>
                </Panel>
              )
            }
            side={
              <>
                {live?.status === "ACTIVE" && (
                  <Panel
                    title="Signed contract"
                    tone={mandates.contractUrl ? "default" : "attention"}
                    description={
                      mandates.contractUrl
                        ? undefined
                        : "Upload the contract you signed with your agent."
                    }
                  >
                    <div className="space-y-3 text-sm">
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
                  </Panel>
                )}
                {mandates.history.length > 0 && (
                  <Panel title="Earlier mandates" tone="muted">
                    <ul className="divide-y divide-line text-sm">
                      {mandates.history.map((mandate) => (
                        <li key={mandate.id} className="py-3 text-muted first:pt-0">
                          <span className="font-semibold text-primary">
                            <PersonName
                              name={mandate.agent.name ?? "Agent"}
                              verified={isVerified(mandate.agent)}
                            />
                          </span>
                          : {MANDATE_STATUS[mandate.status]} (offered{" "}
                          {day(mandate.offeredAt)})
                          {mandate.terminationReason &&
                            ` · reason: ${mandate.terminationReason}`}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </>
            }
          />
        </TabBody>
      )}

      {tab === "compare" && (
        <TabBody>
          {open.length === 0 ? (
            <InvestorEmpty
              title={proposals.length === 0 ? "No proposals yet" : "No open proposals"}
            >
              {proposals.length > 0
                ? "Every proposal has been declined or chosen. See the Declined & chosen tab."
                : listing.status === "APPROVED"
                  ? "Verified agents can now see your property; we will email you when one arrives."
                  : "Agents can send proposals once PropLink approves your listing."}
            </InvestorEmpty>
          ) : (
            <Panel
              title="Open proposals, side by side"
              description={
                canChoose
                  ? "Ask an agent a question, decline them, or choose one for an exclusive mandate."
                  : "You already have an agent; you can still ask questions or decline."
              }
            >
              <ProposalTable
                proposals={open}
                listingId={listing.id}
                canChoose={canChoose}
              />
            </Panel>
          )}
        </TabBody>
      )}

      {tab === "past" && (
        <TabBody>
          <Panel title="Declined and chosen proposals" tone="muted">
            <ProposalTable proposals={closed} listingId={listing.id} canChoose={false} />
          </Panel>
        </TabBody>
      )}
    </div>
  );
}

/** The comparison table: one column per proposal. */
function ProposalTable({
  proposals,
  listingId,
  canChoose,
}: {
  proposals: Proposals;
  listingId: string;
  canChoose: boolean;
}) {
  return (
    <div className="-mx-5 overflow-x-auto border-t border-line sm:-mx-6">
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
              const verified = companyStatusPasses(effectiveCompanyStatus(company));
              const agency = proposal.agent.legacyUser?.agentProfiles[0];
              return (
                <th
                  key={proposal.id}
                  scope="col"
                  className="px-5 py-4 font-semibold text-primary"
                >
                  <span className="flex items-center gap-1.5">
                    <PersonName
                      name={proposal.agent.name ?? "Agent"}
                      verified={Boolean(proposal.agent.verificationBadge)}
                    />
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
              (p: Proposals[number]) => string,
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
                    <p className="font-medium text-primary">{question.question}</p>
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
                        listingId={listingId}
                        proposalId={proposal.id}
                        agentName={proposal.agent.name ?? "this agent"}
                      />
                    )}
                    <AskQuestion listingId={listingId} proposalId={proposal.id} />
                    <DeclineProposal listingId={listingId} proposalId={proposal.id} />
                  </>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
