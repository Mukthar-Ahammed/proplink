import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalSection } from "@/components/portal/PortalShell";
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

const NOMINATION: Record<LeadNominationStatus, string> = {
  NOMINATED: "Waiting for the investor",
  ACCEPTED: "Accepted; waiting for PropLink approval",
  APPROVED: "Approved: Lead Investor",
  DECLINED: "Declined by the investor",
  REJECTED: "Not approved by PropLink",
  WITHDRAWN: "Withdrawn",
};

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

  return (
    <>
      <PortalSection
        title={project.title}
        action={
          <Link
            href="/agent/projects"
            className="text-sm font-semibold text-primary underline"
          >
            All projects
          </Link>
        }
      >
        <ProjectSummary project={project} showExpected />
      </PortalSection>

      <PortalSection title="Lead Investor">
        {project.lead ? (
          <p className="text-sm text-body" data-testid="project-lead">
            {project.lead.name ?? "Lead Investor"} confirmed on{" "}
            {day(project.leadConfirmedAt)}.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Nominate one interested, verified and subscribed investor. They accept, then
            PropLink approves; the project then opens for co-investor pledges.
          </p>
        )}
        {project.nominations.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm">
            {project.nominations.map((nomination) => (
              <li key={nomination.id} className="flex flex-wrap items-center gap-3">
                <span className="text-body">
                  {nomination.investor.name ?? "Investor"} ·{" "}
                  {NOMINATION[nomination.status]} · {day(nomination.nominatedAt)}
                  {nomination.reason ? ` · ${nomination.reason}` : ""}
                </span>
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
        )}
        <h3 className="mt-5 text-sm font-semibold text-primary">Interested investors</h3>
        {project.interests.length === 0 ? (
          <p className="text-sm text-muted">Nobody has expressed interest yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm" data-testid="interested-investors">
            {project.interests.map((interest) => (
              <li key={interest.investorId} className="flex flex-wrap items-center gap-3">
                <span className="text-body">
                  {interest.investor.name ?? "Investor"} · since {day(interest.createdAt)}
                </span>
                <ActionButton
                  action={agentProjectChatAction}
                  hidden={{ projectId: project.id, investorId: interest.investorId }}
                  label="Message"
                  tone="secondary"
                />
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
              </li>
            ))}
          </ul>
        )}
      </PortalSection>

      <PortalSection title="Questions from investors">
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
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
                />
              </ActionButton>
            ) : null
          }
        />
      </PortalSection>

      {works && (
        <PortalSection title="Works and costs">
          <WorksPanel
            view={works}
            projectId={project.id}
            projectStatus={project.status}
            path={`/agent/projects/${project.id}`}
          />
        </PortalSection>
      )}

      {ledger && (
        <PortalSection title="Sale and distributions">
          <LedgerPanel
            view={ledger}
            plan={plan}
            projectId={project.id}
            projectStatus={project.status}
            path={`/agent/projects/${project.id}`}
          />
        </PortalSection>
      )}

      {sellable && (
        <PortalSection title="Retail sale">
          <RelistPanel
            projectId={project.id}
            path={`/agent/projects/${project.id}`}
            listing={retail}
          />
        </PortalSection>
      )}

      {(closable || decisions.length > 0) && (
        <PortalSection title="Project decisions">
          <DecisionPanel
            projectId={project.id}
            path={`/agent/projects/${project.id}`}
            shortfall={isShortfall(project)}
            canDecide={closable}
            decisions={decisions}
          />
        </PortalSection>
      )}

      <PortalSection title="Agreements">
        <AgreementList
          agreements={agreements}
          renderActions={(agreement) =>
            agreement.status === "SENT" && agreement.mine?.signerStatus === "PENDING" ? (
              <ActionButton
                action={signAgreementAction}
                hidden={{
                  agreementId: agreement.id,
                  path: `/agent/projects/${project.id}`,
                }}
                label="Sign the agreement"
              />
            ) : null
          }
        />
      </PortalSection>

      <PortalSection title="Pledges">
        <PledgeTable pledges={pledges} />
      </PortalSection>

      {published && (
        <PortalSection title="Edit terms">
          <p className="mb-4 text-sm text-muted">
            Terms can change until the project opens for investment.
          </p>
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
        </PortalSection>
      )}
    </>
  );
}
