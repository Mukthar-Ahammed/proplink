import Link from "next/link";
import { notFound } from "next/navigation";

import { SubscriptionGate } from "@/components/billing/SubscriptionGate";
import {
  DetailColumns,
  DetailHeader,
  DetailTabs,
  FactList,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { ActionButton } from "@/components/projects/ActionButton";
import { signAgreementAction } from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { day } from "@/components/projects/format";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { PledgeCalculator } from "@/components/projects/PledgeCalculator";
import { Lifecycle } from "@/components/projects/ProjectSummary";
import { LocalPriceChart } from "@/components/projects/LocalPriceChart";
import { ValueChart } from "@/components/projects/ValueChart";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { Badge } from "@/components/ui/badge";
import {
  InvestorProjectStatus,
  LeadNominationStatus,
  Role,
} from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { getComparables } from "@/services/intel/comparables";
import { listAgreements } from "@/services/projects/agreements";
import {
  coInvestorsForLead,
  favouriteIds,
  isProjectMember,
} from "@/services/projects/community";
import {
  formatPence,
  PROJECT_RESPONSIBILITY_NOTICE,
  statusLabel,
} from "@/services/projects/common";
import { getInvestorProject } from "@/services/projects/portal";
import { ledgerView } from "@/services/projects/settlement";
import { worksView } from "@/services/projects/works";

import {
  cancelPledgeAction,
  favouriteAction,
  interestAction,
  nominationResponseAction,
  pledgeAction,
  projectChatAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor — Project", robots: { index: false } };

const PRIMARY_LINK =
  "inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong";

/**
 * One project in the Investor Portal (Phase 4), split into tabs (ADR-080):
 * Overview · Invest · Property & documents · Agreement & progress · Messages.
 * Property details are only what the Agent disclosed; documents need KYC.
 */
export default async function InvestorProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requirePageRole(Role.INVESTOR);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const investor = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getInvestorProject(investor, id);
  if (!project) notFound();
  const [member, favourites, coInvestors, agreementList, works, ledger, comparables] =
    await Promise.all([
      isProjectMember(project.id, investor.profileId),
      favouriteIds(investor.profileId),
      coInvestorsForLead(investor, project.id),
      listAgreements(investor, project.id),
      worksView(investor, project.id),
      ledgerView(investor, project.id),
      // Sold prices in the property's postcode district (sample rows until H5.4).
      project.property.postcodeDistrict
        ? getComparables(project.property.postcodeDistrict)
        : Promise.resolve(null),
    ]);
  const agreements = agreementList ?? [];
  const favourite = favourites.has(project.id);
  const path = `/investor/projects/${project.id}`;
  const raising =
    project.status === InvestorProjectStatus.PUBLISHED ||
    project.status === InvestorProjectStatus.OPEN_FOR_INVESTMENT;
  const open = project.status === InvestorProjectStatus.OPEN_FOR_INVESTMENT;
  const nominated = project.nomination?.status === LeadNominationStatus.NOMINATED;
  const toSign = agreements.some(
    (agreement) =>
      agreement.status === "SENT" && agreement.mine?.signerStatus === "PENDING",
  );
  const modeLabel =
    project.mode === "DEVELOPMENT_JV"
      ? "Development joint venture"
      : "Refurbishment / build";

  const tabs: DetailTab[] = [
    { key: "overview", label: "Overview", attention: nominated },
    { key: "invest", label: project.pledge ? "My pledge" : "Invest" },
    { key: "property", label: "Property & documents" },
  ];
  if (agreements.length > 0 || works || ledger) {
    tabs.push({ key: "progress", label: "Agreement & progress", attention: toSign });
  }
  if (member) tabs.push({ key: "messages", label: "Messages" });
  const tab = pickTab(query.tab, tabs);

  return (
    <>
      <DetailHeader
        back={{ href: "/investor/projects", label: "All projects" }}
        eyebrow={modeLabel}
        title={project.title}
        badges={
          <>
            <Badge tone={open ? "success" : "default"} data-testid="project-status">
              {statusLabel(project.status)}
              {project.closedReason ? `: ${project.closedReason}` : ""}
            </Badge>
            {project.pledge ? <Badge tone="intel">You pledged</Badge> : null}
            {project.lead?.isMe ? <Badge tone="intel">You are the Lead</Badge> : null}
            {open && !project.kycApproved ? (
              <Badge tone="warning">KYC needed to pledge</Badge>
            ) : null}
          </>
        }
        subtitle={project.property.location}
        actions={
          <>
            <ActionButton
              action={favouriteAction}
              hidden={{ projectId: project.id }}
              label={favourite ? "★ Saved" : "☆ Save"}
              tone="secondary"
            />
            {open && !project.pledge && tab !== "invest" ? (
              <Link href={`${path}?tab=invest`} scroll={false} className={PRIMARY_LINK}>
                Pledge now
              </Link>
            ) : null}
          </>
        }
      />

      <KeyFacts
        items={[
          { label: "Capital required", value: formatPence(project.capitalRequiredGBP) },
          {
            label: "Pledged so far",
            value: `${project.progress.percent}%`,
            hint: `${formatPence(project.progress.pledgedGBP)} · ${project.progress.pledgeCount} pledge${project.progress.pledgeCount === 1 ? "" : "s"}`,
          },
          { label: "Minimum pledge", value: formatPence(project.minimumPledgeGBP) },
          { label: "Funding deadline", value: day(project.fundingDeadline) },
          {
            label: "Price, value and funding",
            value: null,
            wide: {
              content: (
                <ValueChart
                  purchaseGBP={project.purchaseGBP}
                  marketValueGBP={project.marketValueGBP}
                  capitalRequiredGBP={project.capitalRequiredGBP}
                  pledgedGBP={project.progress.pledgedGBP}
                  localMedian={
                    comparables && comparables.points.length > 0
                      ? {
                          district: comparables.postcodeDistrict,
                          valueGBP: BigInt(
                            comparables.points[comparables.points.length - 1]
                              .medianPriceGBP,
                          ),
                        }
                      : null
                  }
                  aside={
                    comparables && comparables.points.length > 1 ? (
                      <LocalPriceChart
                        district={comparables.postcodeDistrict}
                        points={comparables.points}
                        isSample={comparables.isSample}
                      />
                    ) : undefined
                  }
                />
              ),
            },
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Project sections" />

      {tab === "overview" && (
        <TabBody>
          <DetailColumns
            main={
              <>
                <Panel title="Where this project is">
                  <Lifecycle status={project.status} />
                </Panel>
                <Panel title="About this project">
                  <p className="text-sm whitespace-pre-line text-body">
                    {project.summary}
                  </p>
                </Panel>
                <Panel title="Terms">
                  <FactList
                    items={[
                      { label: "Type", value: modeLabel },
                      {
                        label: "Total capital required",
                        value: formatPence(project.capitalRequiredGBP),
                      },
                      {
                        label: "Minimum pledge",
                        value: formatPence(project.minimumPledgeGBP),
                      },
                      { label: "Funding deadline", value: day(project.fundingDeadline) },
                      {
                        label: "Purchase amount",
                        value: formatPence(project.purchaseGBP),
                      },
                      ...(project.showExpected
                        ? [
                            {
                              label: "Expected profit (estimate)",
                              value:
                                project.expectedProfitGBP === null
                                  ? null
                                  : formatPence(project.expectedProfitGBP),
                            },
                            {
                              label: "Expected time",
                              value: project.expectedMonths
                                ? `${project.expectedMonths} months`
                                : null,
                            },
                          ]
                        : []),
                    ]}
                  />
                  <p className="mt-5 rounded-lg bg-surface p-3 text-xs text-muted">
                    {PROJECT_RESPONSIBILITY_NOTICE}
                  </p>
                </Panel>
              </>
            }
            side={
              <>
                {project.nomination && (
                  <Panel
                    title="Lead Investor nomination"
                    tone={nominated ? "attention" : "muted"}
                    testId="nomination"
                  >
                    {nominated ? (
                      <>
                        <p className="text-sm text-body">
                          The agent nominated you as Lead Investor. As Lead you hold
                          executive authority over budget and scope decisions, recorded by
                          the Solicitor.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <ActionButton
                            action={nominationResponseAction}
                            hidden={{
                              intent: "accept",
                              nominationId: project.nomination.id,
                              projectId: project.id,
                            }}
                            label="Accept nomination"
                          />
                          <ActionButton
                            action={nominationResponseAction}
                            hidden={{
                              intent: "decline",
                              nominationId: project.nomination.id,
                              projectId: project.id,
                            }}
                            label="Decline"
                            tone="secondary"
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-body">
                        You accepted the Lead nomination; PropLink is reviewing it.
                      </p>
                    )}
                  </Panel>
                )}
                <Panel title="Lead Investor">
                  {project.lead ? (
                    <p className="text-sm text-body" data-testid="lead-stats">
                      {project.lead.isMe
                        ? "You are this project's Lead Investor."
                        : project.lead.publicId
                          ? `Investor ${project.lead.publicId}${project.lead.verified ? " (verified)" : ""}`
                          : `A ${project.lead.verified ? "verified " : ""}investor (private profile)`}
                      <span className="mt-1 block text-muted">
                        {project.lead.led} project{project.lead.led === 1 ? "" : "s"} led
                        · {project.lead.completed} completed
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted">
                      Not confirmed yet. Co-investor pledges open once PropLink confirms
                      the Lead.
                    </p>
                  )}
                </Panel>
                {raising && (
                  <Panel
                    title="Your interest"
                    description={
                      project.interested
                        ? "The agent can see you are interested."
                        : "Tell the agent you are interested. The Lead is nominated from this list."
                    }
                  >
                    {project.interested ? (
                      <ActionButton
                        action={interestAction}
                        hidden={{ intent: "withdraw", projectId: project.id }}
                        label="Withdraw interest"
                        tone="secondary"
                      />
                    ) : (
                      <ActionButton
                        action={interestAction}
                        hidden={{ intent: "interest", projectId: project.id }}
                        label="I'm interested"
                      />
                    )}
                  </Panel>
                )}
              </>
            }
          />
        </TabBody>
      )}

      {tab === "invest" && (
        <TabBody>
          <DetailColumns
            main={
              project.pledge ? (
                <Panel title="Your pledge" testId="my-pledge">
                  <p className="text-3xl font-semibold tracking-tight text-primary">
                    {formatPence(project.pledge.amountGBP)}
                  </p>
                  <p className="mt-1 text-sm text-body">
                    share {project.pledge.share} ·{" "}
                    {project.pledge.status === "BINDING"
                      ? "binding (agreement signed)"
                      : "expression of interest (not yet signed)"}
                  </p>
                  {project.pledge.status === "PLEDGED" && (
                    <div className="mt-4">
                      <ActionButton
                        action={cancelPledgeAction}
                        hidden={{ pledgeId: project.pledge.id, projectId: project.id }}
                        label="Cancel pledge"
                        tone="secondary"
                      />
                    </div>
                  )}
                </Panel>
              ) : open ? (
                project.kycApproved ? (
                  <Panel
                    title="Make a pledge"
                    description="A pledge is an expression of interest until you sign the agreement. No money moves through PropLink."
                  >
                    <PledgeCalculator
                      projectId={project.id}
                      capital={project.capitalRequiredGBP.toString()}
                      minimum={project.minimumPledgeGBP.toString()}
                      pledgedSoFar={project.progress.pledgedGBP.toString()}
                      expectedProfit={
                        project.expectedProfitForCalculator?.toString() ?? null
                      }
                      showProjection={project.showProjection}
                      action={pledgeAction}
                    />
                  </Panel>
                ) : (
                  <Panel title="Verify your identity to pledge" tone="attention">
                    <p className="text-sm text-body">
                      Pledging needs approved identity verification (KYC).
                    </p>
                    <Link href="/investor/kyc" className={`mt-4 ${PRIMARY_LINK}`}>
                      Verify now
                    </Link>
                  </Panel>
                )
              ) : (
                <Panel title="Pledges" tone="muted">
                  <p className="text-sm text-muted">
                    {project.status === InvestorProjectStatus.PUBLISHED
                      ? "Pledges open once the Lead Investor is confirmed."
                      : "This project is not taking pledges."}
                  </p>
                </Panel>
              )
            }
            side={
              <Panel title="Funding">
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-pale"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={project.progress.percent}
                  aria-label="Pledged so far"
                >
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, project.progress.percent)}%` }}
                  />
                </div>
                <p className="mt-3 text-sm text-body" data-testid="funding-progress">
                  <strong>{formatPence(project.progress.pledgedGBP)}</strong> pledged of{" "}
                  {formatPence(project.capitalRequiredGBP)}
                  <span className="mt-1 block text-muted">
                    {formatPence(project.progress.remainingGBP)} remains ·{" "}
                    {project.progress.pledgeCount} pledge
                    {project.progress.pledgeCount === 1 ? "" : "s"}
                  </span>
                </p>
              </Panel>
            }
          />
        </TabBody>
      )}

      {tab === "property" && (
        <TabBody>
          <Panel
            title="The property"
            description="Only what the agent has disclosed to investors."
          >
            <FactList
              testId="investor-property"
              items={[
                { label: "Location", value: project.property.location },
                {
                  label: "Landlord",
                  value: project.property.landlordName ?? "Not disclosed",
                },
                {
                  label: "Type",
                  value: project.property.propertyType ?? project.property.propertyKind,
                },
                {
                  label: "Land area",
                  value: project.property.landAreaSqm
                    ? `${project.property.landAreaSqm} m²`
                    : null,
                },
                {
                  label: "Description",
                  value: project.property.description ?? "Not disclosed",
                  wide: true,
                },
                {
                  label: "Known defects",
                  value: project.property.defects ?? "Not disclosed",
                },
                {
                  label: "Work required",
                  value: project.property.requiredWork ?? "Not disclosed",
                },
              ]}
            />
          </Panel>
          {project.photos.length > 0 && (
            <Panel title="Photos">
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {project.photos.map((url, index) => (
                  <li key={url}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                    <img
                      src={url}
                      alt={`Property photo ${index + 1}`}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Documents">
            {project.kycApproved ? (
              project.documents.length === 0 ? (
                <p className="text-sm text-muted">No documents shared.</p>
              ) : (
                <ul className="space-y-1 text-sm" data-testid="project-documents">
                  {project.documents.map((url, index) => (
                    <li key={url}>
                      <a
                        href={url}
                        className="text-accent underline"
                        rel="noopener noreferrer"
                      >
                        Document {index + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="text-sm text-muted" data-testid="documents-locked">
                Documents are available once your identity verification (KYC) is approved.{" "}
                <Link href="/investor/kyc" className="text-accent underline">
                  Verify now
                </Link>
              </p>
            )}
          </Panel>
        </TabBody>
      )}

      {tab === "progress" && (
        <TabBody>
          {agreements.length > 0 && (
            <Panel title="Your agreement" tone={toSign ? "attention" : "default"}>
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
          )}
          {works && (
            <Panel title="Works and costs">
              <WorksPanel
                view={works}
                projectId={project.id}
                projectStatus={project.status}
                path={path}
              />
            </Panel>
          )}
          {ledger && (
            <Panel title="Sale and distributions">
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

      {tab === "messages" && (
        <TabBody>
          <Panel
            title="Project chats"
            description="Chats open once PropLink authorises them, and need an active subscription on both sides. Pledging does not need one."
          >
            <SubscriptionGate reason="Project chats need an active Lead Investor or Co-Investor subscription, and PropLink's authorisation for each chat. Browsing and pledging stay free.">
              <div className="flex flex-wrap gap-3">
                <ActionButton
                  action={projectChatAction}
                  hidden={{ projectId: project.id, with: "agent" }}
                  label="Message the agent"
                  tone="secondary"
                />
                {project.lead && !project.lead.isMe && (
                  <ActionButton
                    action={projectChatAction}
                    hidden={{ projectId: project.id, with: "lead" }}
                    label="Message the Lead Investor"
                    tone="secondary"
                  />
                )}
              </div>
            </SubscriptionGate>
          </Panel>
          {coInvestors.length > 0 && (
            <Panel
              title="Your co-investors"
              description="Shown by alias only: co-investors stay anonymous to you, and you to them."
            >
              <ul className="divide-y divide-line text-sm" data-testid="co-investors">
                {coInvestors.map((co) => (
                  <li
                    key={co.alias}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span className="flex items-center gap-2 text-body">
                      {co.alias}
                      <Badge tone={co.pledged ? "success" : "default"}>
                        {co.pledged ? "Pledged" : "Interested"}
                      </Badge>
                    </span>
                    <SubscriptionGate
                      triggerLabel="Subscribe to message"
                      triggerTone="secondary"
                    >
                      <ActionButton
                        action={projectChatAction}
                        hidden={{
                          projectId: project.id,
                          with: "co-investor",
                          coInvestor: co.alias,
                        }}
                        label="Message"
                        tone="secondary"
                      />
                    </SubscriptionGate>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </TabBody>
      )}
    </>
  );
}
