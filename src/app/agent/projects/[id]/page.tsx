import Link from "next/link";
import { notFound } from "next/navigation";

import { SubscriptionGate } from "@/components/billing/SubscriptionGate";
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
import { ActionButton } from "@/components/projects/ActionButton";
import { signAgreementAction } from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { DecisionPanel } from "@/components/projects/DecisionPanel";
import { day, penceToPoundsInput } from "@/components/projects/format";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { PledgeTable } from "@/components/projects/PledgeTable";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import { ProjectTermsForm } from "@/components/projects/ProjectTermsForm";
import { RelistPanel } from "@/components/projects/RelistPanel";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { isVerified, PersonName } from "@/components/profiles/PersonName";
import { Badge } from "@/components/ui/badge";
import {
  InvestorProjectStatus,
  LeadNominationStatus,
  Role,
} from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { listAgreements } from "@/services/projects/agreements";
import {
  formatPence,
  PROJECT_RESPONSIBILITY_NOTICE,
  statusLabel,
} from "@/services/projects/common";
import { isShortfall, listDecisions } from "@/services/projects/decisions";
import { listProjectPledges } from "@/services/projects/pledges";
import { getManagedProject } from "@/services/projects/projects";
import { retailListingFor } from "@/services/projects/relist";
import { ledgerView } from "@/services/projects/settlement";
import { worksView } from "@/services/projects/works";

import {
  agentProjectChatAction,
  leadNominationAction,
  updateProjectAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Investor project", robots: { index: false } };

const NOMINATION: Record<LeadNominationStatus, string> = {
  NOMINATED: "Waiting for the investor",
  ACCEPTED: "Accepted; waiting for PropLink approval",
  APPROVED: "Approved: Lead Investor",
  DECLINED: "Declined by the investor",
  REJECTED: "Not approved by PropLink",
  WITHDRAWN: "Withdrawn",
};

const NOMINATION_TONE: Record<
  LeadNominationStatus,
  "default" | "success" | "warning" | "danger" | "intel"
> = {
  NOMINATED: "intel",
  ACCEPTED: "warning",
  APPROVED: "success",
  DECLINED: "default",
  REJECTED: "danger",
  WITHDRAWN: "default",
};

const LIVE_PLEDGE = new Set(["PLEDGED", "BINDING"]);

const PRIMARY_LINK =
  "inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong";

/**
 * The Agent's management page for one project (Phase 4 Tasks 1-2), split into
 * tabs (ADR-080): Overview · Investors & Lead · Pledges · Agreements & works ·
 * Sale & decisions · Edit terms.
 */
export default async function AgentProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const agent = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getManagedProject(agent, id);
  if (!project) notFound();
  const [pledgeList, agreementList, works, decisions, retail, ledger] = await Promise.all(
    [
      listProjectPledges(agent, project.id),
      listAgreements(agent, project.id),
      worksView(agent, project.id),
      listDecisions(project.id),
      retailListingFor(project.id),
      ledgerView(agent, project.id),
    ],
  );
  const pledges = pledgeList ?? [];
  const agreements = agreementList ?? [];
  const sellable = ["COMPLETED", "LISTED_FOR_SALE", "SOLD"].includes(project.status);
  const closable = ["PUBLISHED", "OPEN_FOR_INVESTMENT", "FUNDED"].includes(
    project.status,
  );
  const published = project.status === InvestorProjectStatus.PUBLISHED;
  const live = project.nominations.find(
    (nomination) =>
      nomination.status === LeadNominationStatus.NOMINATED ||
      nomination.status === LeadNominationStatus.ACCEPTED,
  );
  const canNominate = published && !project.leadInvestorId && !live;
  const path = `/agent/projects/${project.id}`;

  const livePledges = pledges.filter((pledge) => LIVE_PLEDGE.has(pledge.status));
  const pledged = livePledges.reduce((sum, pledge) => sum + pledge.amountGBP, BigInt(0));
  const percent =
    project.capitalRequiredGBP > BigInt(0)
      ? Number((pledged * BigInt(1000)) / project.capitalRequiredGBP) / 10
      : 0;
  const toSign = agreements.some(
    (agreement) =>
      agreement.status === "SENT" && agreement.mine?.signerStatus === "PENDING",
  );
  const needsLead = canNominate && project.interests.length > 0;

  const tabs: DetailTab[] = [
    { key: "overview", label: "Overview" },
    {
      key: "investors",
      label: "Investors & Lead",
      count: project.interests.length,
      attention: needsLead,
    },
    { key: "pledges", label: "Pledges", count: livePledges.length },
    { key: "agreements", label: "Agreements & works", attention: toSign },
  ];
  if (ledger || sellable || closable || decisions.length > 0) {
    tabs.push({ key: "sale", label: "Sale & decisions" });
  }
  if (published) tabs.push({ key: "edit", label: "Edit terms" });
  const tab = pickTab(query.tab, tabs);

  // What the Agent should do next, surfaced on the Overview.
  const nextStep = toSign
    ? { text: "An agreement is waiting for your signature.", tab: "agreements" }
    : needsLead
      ? {
          text: "Investors are interested. Nominate one as Lead Investor to open pledges.",
          tab: "investors",
        }
      : published && !project.leadInvestorId && !live
        ? {
            text: "Share the project and wait for investors to express interest.",
            tab: "investors",
          }
        : null;

  return (
    <>
      <DetailHeader
        back={{ href: "/agent/projects", label: "All projects" }}
        eyebrow={
          project.mode === "DEVELOPMENT_JV"
            ? "Development joint venture"
            : "Refurbishment / build"
        }
        title={project.title}
        badges={
          <>
            <Badge
              tone={
                project.status === InvestorProjectStatus.OPEN_FOR_INVESTMENT
                  ? "success"
                  : "default"
              }
            >
              {statusLabel(project.status)}
            </Badge>
            {project.lead ? (
              <Badge tone="intel">
                Lead:{" "}
                <PersonName
                  name={project.lead.name ?? "confirmed"}
                  verified={isVerified(project.lead)}
                />
              </Badge>
            ) : (
              <Badge tone="warning">No Lead yet</Badge>
            )}
            {project.listing?.city ? <Badge>{project.listing.city}</Badge> : null}
          </>
        }
        actions={
          published && tab !== "edit" ? (
            <Link href={`${path}?tab=edit`} scroll={false} className={PRIMARY_LINK}>
              Edit terms
            </Link>
          ) : null
        }
      />

      <KeyFacts
        items={[
          { label: "Capital required", value: formatPence(project.capitalRequiredGBP) },
          {
            label: "Pledged so far",
            value: `${percent}%`,
            hint: `${formatPence(pledged)} · ${livePledges.length} pledge${livePledges.length === 1 ? "" : "s"}`,
          },
          { label: "Minimum pledge", value: formatPence(project.minimumPledgeGBP) },
          { label: "Funding deadline", value: day(project.fundingDeadline) },
          {
            label: "Interested investors",
            value: project.interests.length,
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Project sections" />

      {tab === "overview" && (
        <TabBody>
          <DetailColumns
            main={
              <Panel title="Project summary">
                <ProjectSummary project={project} showExpected />
              </Panel>
            }
            side={
              <>
                <Panel
                  title="Next step"
                  tone={nextStep && (toSign || needsLead) ? "attention" : "muted"}
                >
                  {nextStep ? (
                    <>
                      <p className="text-sm text-body">{nextStep.text}</p>
                      <Link
                        href={`${path}?tab=${nextStep.tab}`}
                        scroll={false}
                        className="mt-3 inline-flex text-sm font-semibold text-accent hover:text-accent-strong"
                      >
                        Go there →
                      </Link>
                    </>
                  ) : (
                    <p className="text-sm text-muted">Nothing is waiting on you.</p>
                  )}
                </Panel>
                <Panel title="Lead Investor">
                  {project.lead ? (
                    <p className="text-sm text-body">
                      <PersonName
                        name={project.lead.name ?? "Lead Investor"}
                        verified={isVerified(project.lead)}
                      />{" "}
                      confirmed on {day(project.leadConfirmedAt)}.
                    </p>
                  ) : live ? (
                    <p className="text-sm text-body">
                      <PersonName
                        name={live.investor.name ?? "Investor"}
                        verified={isVerified(live.investor)}
                      />
                      : {NOMINATION[live.status]}
                    </p>
                  ) : (
                    <p className="text-sm text-muted">Not nominated yet.</p>
                  )}
                </Panel>
              </>
            }
          />
        </TabBody>
      )}

      {tab === "investors" && (
        <TabBody>
          <DetailColumns
            main={
              <Panel
                title="Interested investors"
                description={
                  canNominate
                    ? "Nominate one interested, identity-verified investor as Lead. They accept, then PropLink approves; the project then opens for co-investor pledges."
                    : undefined
                }
                tone={needsLead ? "attention" : "default"}
              >
                {project.interests.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-6 text-center text-sm text-muted">
                    Nobody has expressed interest yet.
                  </p>
                ) : (
                  <ul
                    className="divide-y divide-line text-sm"
                    data-testid="interested-investors"
                  >
                    {project.interests.map((interest) => (
                      <li
                        key={interest.investorId}
                        className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-primary">
                            <PersonName
                              name={interest.investor.name ?? "Investor"}
                              verified={isVerified(interest.investor)}
                            />
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            since {day(interest.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-start gap-3">
                          <SubscriptionGate
                            triggerLabel="Subscribe to message"
                            triggerTone="secondary"
                            reason="Chatting with investors needs an active Agent subscription, and PropLink's authorisation for each chat."
                          >
                            <ActionButton
                              action={agentProjectChatAction}
                              hidden={{
                                projectId: project.id,
                                investorId: interest.investorId,
                              }}
                              label="Message"
                              tone="secondary"
                            />
                          </SubscriptionGate>
                          {canNominate && (
                            <ActionButton
                              action={leadNominationAction}
                              hidden={{
                                intent: "nominate",
                                projectId: project.id,
                                investorId: interest.investorId,
                              }}
                              label="Nominate as Lead"
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            }
            side={
              <>
                <Panel title="Lead Investor">
                  {project.lead ? (
                    <p className="text-sm text-body" data-testid="project-lead">
                      <PersonName
                        name={project.lead.name ?? "Lead Investor"}
                        verified={isVerified(project.lead)}
                      />{" "}
                      confirmed on {day(project.leadConfirmedAt)}.
                    </p>
                  ) : (
                    <p className="text-sm text-muted">
                      Not confirmed yet. Co-investor pledges open once PropLink approves
                      the Lead.
                    </p>
                  )}
                </Panel>
                {project.nominations.length > 0 && (
                  <Panel title="Nominations">
                    <ul className="divide-y divide-line text-sm">
                      {project.nominations.map((nomination) => (
                        <li key={nomination.id} className="space-y-2 py-3">
                          <p className="font-semibold text-primary">
                            <PersonName
                              name={nomination.investor.name ?? "Investor"}
                              verified={isVerified(nomination.investor)}
                            />
                          </p>
                          <Badge tone={NOMINATION_TONE[nomination.status]}>
                            {NOMINATION[nomination.status]}
                          </Badge>
                          <p className="text-xs break-words text-muted">
                            {day(nomination.nominatedAt)}
                            {nomination.reason ? ` · ${nomination.reason}` : ""}
                          </p>
                          {(nomination.status === LeadNominationStatus.NOMINATED ||
                            nomination.status === LeadNominationStatus.ACCEPTED) && (
                            <ActionButton
                              action={leadNominationAction}
                              hidden={{
                                intent: "withdraw",
                                nominationId: nomination.id,
                                projectId: project.id,
                              }}
                              label="Withdraw"
                              tone="secondary"
                            />
                          )}
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

      {tab === "pledges" && (
        <TabBody>
          <Panel
            title="Pledges"
            description="A pledge is an expression of interest until the investor signs the agreement. No money moves through PropLink."
          >
            <div className="overflow-x-auto">
              <PledgeTable pledges={pledges} />
            </div>
          </Panel>
        </TabBody>
      )}

      {tab === "agreements" && (
        <TabBody>
          <Panel title="Agreements" tone={toSign ? "attention" : "default"}>
            <AgreementList
              agreements={agreements}
              renderActions={(agreement) =>
                agreement.status === "SENT" &&
                agreement.mine?.signerStatus === "PENDING" ? (
                  <ActionButton
                    action={signAgreementAction}
                    hidden={{ agreementId: agreement.id, path }}
                    label="Sign the agreement"
                  />
                ) : null
              }
            />
          </Panel>
          {works ? (
            <Panel title="Works and costs">
              <WorksPanel
                view={works}
                projectId={project.id}
                projectStatus={project.status}
                path={path}
              />
            </Panel>
          ) : (
            <Panel title="Works and costs" tone="muted">
              <p className="text-sm text-muted">
                Works are tracked once the project is funded.
              </p>
            </Panel>
          )}
        </TabBody>
      )}

      {tab === "sale" && (
        <TabBody>
          {(closable || decisions.length > 0) && (
            <Panel title="Project decisions">
              <DecisionPanel
                projectId={project.id}
                path={path}
                shortfall={isShortfall(project)}
                canDecide={closable}
                decisions={decisions}
              />
            </Panel>
          )}
          {sellable && (
            <Panel title="Retail sale">
              <RelistPanel projectId={project.id} path={path} listing={retail} />
            </Panel>
          )}
          {ledger && (
            <Panel
              title="Sale and distributions"
              description="Recorded by the project Solicitor. PropLink never holds or moves the money."
            >
              <LedgerPanel
                view={ledger}
                // Only the Solicitor sees the settlement plan (every party's amounts).
                plan={null}
                projectId={project.id}
                projectStatus={project.status}
                path={path}
              />
            </Panel>
          )}
        </TabBody>
      )}

      {tab === "edit" && (
        <TabBody>
          <Panel
            title="Edit terms"
            description="Terms can change until the project opens for investment."
          >
            <ProjectTermsForm
              action={updateProjectAction}
              hidden={{ projectId: project.id }}
              submitLabel="Save terms"
              notice={PROJECT_RESPONSIBILITY_NOTICE}
              defaults={{
                title: project.title,
                summary: project.summary,
                mode: project.mode,
                capitalRequired: penceToPoundsInput(project.capitalRequiredGBP),
                minimumPledge: penceToPoundsInput(project.minimumPledgeGBP),
                fundingDeadline: day(project.fundingDeadline),
                purchase: penceToPoundsInput(project.purchaseGBP),
                marketValue: penceToPoundsInput(project.marketValueGBP),
                expectedProfit: penceToPoundsInput(project.expectedProfitGBP),
                expectedMonths: project.expectedMonths
                  ? String(project.expectedMonths)
                  : "",
              }}
            />
          </Panel>
        </TabBody>
      )}
    </>
  );
}
