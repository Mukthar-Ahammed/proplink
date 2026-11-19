import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArrowIcon,
  ChartIcon,
  IconChip,
  InvestorSectionTitle,
  StatusPill,
  UserIcon,
} from "@/components/investor/InvestorUi";
import { INPUT } from "@/app/landlord/listings/ui";
import { SubscriptionGate } from "@/components/billing/SubscriptionGate";
import { ActionButton } from "@/components/projects/ActionButton";
import { day, penceToPoundsInput } from "@/components/projects/format";
import { PledgeTable } from "@/components/projects/PledgeTable";
import { QuestionList } from "@/components/projects/QuestionList";
import { signAgreementAction } from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { DecisionPanel } from "@/components/projects/DecisionPanel";
import { RelistPanel } from "@/components/projects/RelistPanel";
import { retailListingFor } from "@/services/projects/relist";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { isShortfall, listDecisions } from "@/services/projects/decisions";
import { ledgerView } from "@/services/projects/settlement";
import { worksView } from "@/services/projects/works";
import { listAgreements } from "@/services/projects/agreements";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import { ProjectTermsForm } from "@/components/projects/ProjectTermsForm";
import {
  InvestorProjectStatus,
  LeadNominationStatus,
  Role,
} from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { PROJECT_RESPONSIBILITY_NOTICE } from "@/services/projects/common";
import { listProjectQuestions } from "@/services/projects/community";
import { listProjectPledges } from "@/services/projects/pledges";
import { getManagedProject } from "@/services/projects/projects";

import {
  agentProjectChatAction,
  answerQuestionAction,
  leadNominationAction,
  updateProjectAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Investor project", robots: { index: false } };

const CARD = "rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7";
const EYEBROW = "text-xs font-semibold tracking-[0.14em] text-muted uppercase";

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
  "accent" | "success" | "warning" | "danger" | "neutral"
> = {
  NOMINATED: "accent",
  ACCEPTED: "warning",
  APPROVED: "success",
  DECLINED: "neutral",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};

/** One titled block: sans heading with an italic-serif tail, content in a card. */
function Section({
  title,
  tail,
  description,
  bare = false,
  children,
}: {
  title: string;
  tail?: string;
  description?: string;
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <InvestorSectionTitle title={title} tail={tail} description={description} />
      {bare ? children : <div className={CARD}>{children}</div>}
    </section>
  );
}

/** The Agent's management page for one project (Phase 4 Tasks 1-2). */
export default async function AgentProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const { id } = await params;
  const agent = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getManagedProject(agent, id);
  if (!project) notFound();
  const pledges = (await listProjectPledges(agent, project.id)) ?? [];
  const questions = (await listProjectQuestions(agent, project.id)) ?? [];
  const agreements = (await listAgreements(agent, project.id)) ?? [];
  const works = await worksView(agent, project.id);
  const decisions = await listDecisions(project.id);
  const retail = await retailListingFor(project.id);
  const sellable = ["COMPLETED", "LISTED_FOR_SALE", "SOLD"].includes(project.status);
  const closable = ["PUBLISHED", "OPEN_FOR_INVESTMENT", "FUNDED"].includes(
    project.status,
  );
  const [ledger, plan] = await Promise.all([
    ledgerView(agent, project.id),
    // Only the Solicitor sees the settlement plan (every party's amounts).
    Promise.resolve(null),
  ]);
  const published = project.status === InvestorProjectStatus.PUBLISHED;
  const live = project.nominations.find(
    (nomination) =>
      nomination.status === LeadNominationStatus.NOMINATED ||
      nomination.status === LeadNominationStatus.ACCEPTED,
  );
  const canNominate = published && !project.leadInvestorId && !live;
  const path = `/agent/projects/${project.id}`;

  return (
    <div className="space-y-12">
      {/* --------------------------------------------------------- header */}
      <section className="space-y-5">
        <div className="space-y-4">
          <Link
            href="/agent/projects"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
          >
            <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
            All projects
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <IconChip>
              <ChartIcon />
            </IconChip>
            <h2 className="font-display min-w-0 text-2xl leading-tight font-semibold tracking-[-0.02em] break-words text-primary sm:text-[1.75rem]">
              {project.title}
            </h2>
          </div>
        </div>
        <div className={CARD}>
          <ProjectSummary project={project} showExpected />
        </div>
      </section>

      {/* -------------------------------------------------- lead investor */}
      <Section title="Lead" tail="Investor">
        <div className="flex items-start gap-3">
          <IconChip tone={project.lead ? "success" : "accent"}>
            <UserIcon />
          </IconChip>
          {project.lead ? (
            <p className="pt-2 text-sm text-body" data-testid="project-lead">
              {project.lead.name ?? "Lead Investor"} confirmed on{" "}
              {day(project.leadConfirmedAt)}.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              Nominate one interested, identity-verified investor. They accept, then
              PropLink approves; the project then opens for co-investor pledges.
            </p>
          )}
        </div>

        {project.nominations.length > 0 && (
          <div className="mt-6">
            <p className={EYEBROW}>Nominations</p>
            <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
              {project.nominations.map((nomination) => (
                <li
                  key={nomination.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-primary">
                        {nomination.investor.name ?? "Investor"}
                      </span>
                      <StatusPill tone={NOMINATION_TONE[nomination.status]}>
                        {NOMINATION[nomination.status]}
                      </StatusPill>
                    </div>
                    <p className="mt-1 text-xs break-words text-muted">
                      {day(nomination.nominatedAt)}
                      {nomination.reason ? ` · ${nomination.reason}` : ""}
                    </p>
                  </div>
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
          </div>
        )}

        <h3 className="mt-6 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Interested investors
        </h3>
        {project.interests.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-6 text-center text-sm text-muted">
            Nobody has expressed interest yet.
          </p>
        ) : (
          <ul
            className="mt-3 divide-y divide-line border-t border-line text-sm"
            data-testid="interested-investors"
          >
            {project.interests.map((interest) => (
              <li
                key={interest.investorId}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-primary">
                    {interest.investor.name ?? "Investor"}
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
                      hidden={{ projectId: project.id, investorId: interest.investorId }}
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
      </Section>

      <Section title="Questions from" tail="investors">
        <QuestionList
          questions={questions}
          renderActions={(question) =>
            question.status === "OPEN" ? (
              <ActionButton
                action={answerQuestionAction}
                hidden={{ questionId: question.id, projectId: project.id }}
                label="Answer"
              >
                <textarea
                  name="answer"
                  required
                  rows={2}
                  maxLength={2000}
                  aria-label="Your answer"
                  className={INPUT}
                />
              </ActionButton>
            ) : null
          }
        />
      </Section>

      {works && (
        <Section title="Works and" tail="costs">
          <WorksPanel
            view={works}
            projectId={project.id}
            projectStatus={project.status}
            path={path}
          />
        </Section>
      )}

      {ledger && (
        <Section
          title="Sale and"
          tail="distributions"
          description="Recorded by the project Solicitor. PropLink never holds or moves the money."
        >
          <LedgerPanel
            view={ledger}
            plan={plan}
            projectId={project.id}
            projectStatus={project.status}
            path={path}
          />
        </Section>
      )}

      {sellable && (
        <Section title="Retail" tail="sale">
          <RelistPanel projectId={project.id} path={path} listing={retail} />
        </Section>
      )}

      {(closable || decisions.length > 0) && (
        <Section title="Project" tail="decisions">
          <DecisionPanel
            projectId={project.id}
            path={path}
            shortfall={isShortfall(project)}
            canDecide={closable}
            decisions={decisions}
          />
        </Section>
      )}

      <Section title="Agreements" bare>
        <AgreementList
          agreements={agreements}
          renderActions={(agreement) =>
            agreement.status === "SENT" && agreement.mine?.signerStatus === "PENDING" ? (
              <ActionButton
                action={signAgreementAction}
                hidden={{ agreementId: agreement.id, path }}
                label="Sign the agreement"
              />
            ) : null
          }
        />
      </Section>

      <Section title="Pledges">
        <div className="overflow-x-auto">
          <PledgeTable pledges={pledges} />
        </div>
      </Section>

      {published && (
        <Section
          title="Edit"
          tail="terms"
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
        </Section>
      )}
    </div>
  );
}
