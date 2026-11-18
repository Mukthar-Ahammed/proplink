import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalSection } from "@/components/portal/PortalShell";
import { ActionButton } from "@/components/projects/ActionButton";
import { PledgeCalculator } from "@/components/projects/PledgeCalculator";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import {
  InvestorProjectStatus,
  LeadNominationStatus,
  Role,
} from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { QuestionList } from "@/components/projects/QuestionList";
import { signAgreementAction } from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { worksView } from "@/services/projects/works";
import { listAgreements } from "@/services/projects/agreements";
import {
  coInvestorsForLead,
  favouriteIds,
  isProjectMember,
  listProjectQuestions,
} from "@/services/projects/community";
import { formatPence } from "@/services/projects/common";
import { getInvestorProject } from "@/services/projects/portal";

import {
  askQuestionAction,
  cancelPledgeAction,
  favouriteAction,
  interestAction,
  nominationResponseAction,
  pledgeAction,
  projectChatAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor — Project", robots: { index: false } };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

/**
 * One project in the Investor Portal (Phase 4). Property details are only
 * what the Agent disclosed; documents need KYC approval.
 */
export default async function InvestorProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.INVESTOR);
  const { id } = await params;
  const investor = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getInvestorProject(investor, id);
  if (!project) notFound();
  const [member, favourites, questions, coInvestors] = await Promise.all([
    isProjectMember(project.id, investor.profileId),
    favouriteIds(investor.profileId),
    listProjectQuestions(investor, project.id),
    coInvestorsForLead(investor, project.id),
  ]);
  const favourite = favourites.has(project.id);
  const agreements = (await listAgreements(investor, project.id)) ?? [];
  const works = await worksView(investor, project.id);
  const raising =
    project.status === InvestorProjectStatus.PUBLISHED ||
    project.status === InvestorProjectStatus.OPEN_FOR_INVESTMENT;

  return (
    <>
      <PortalSection
        title={project.title}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton
              action={favouriteAction}
              hidden={{ projectId: project.id }}
              label={favourite ? "★ Saved" : "☆ Save"}
              tone="secondary"
            />
            <Link
              href="/investor/projects"
              className="text-sm font-semibold text-primary underline"
            >
              All projects
            </Link>
          </div>
        }
      >
        <ProjectSummary project={project} showExpected={project.showExpected} />
      </PortalSection>

      <PortalSection title="Lead Investor">
        {project.lead ? (
          <p className="text-sm text-body" data-testid="lead-stats">
            {project.lead.isMe
              ? "You are this project's Lead Investor."
              : project.lead.name
                ? `${project.lead.name}${project.lead.verified ? " (verified)" : ""}`
                : `A ${project.lead.verified ? "verified " : ""}investor (private profile)`}{" "}
            · {project.lead.led} project{project.lead.led === 1 ? "" : "s"} led ·{" "}
            {project.lead.completed} completed
          </p>
        ) : (
          <p className="text-sm text-muted">
            The Lead Investor is not confirmed yet. Co-investor pledges open once PropLink
            confirms the Lead.
          </p>
        )}
        {project.nomination && (
          <div
            className="mt-4 rounded-lg border border-line bg-white p-4"
            data-testid="nomination"
          >
            {project.nomination.status === LeadNominationStatus.NOMINATED ? (
              <>
                <p className="text-sm text-body">
                  The agent nominated you as Lead Investor. As Lead you hold executive
                  authority over budget and scope decisions, recorded by the Solicitor.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
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
          </div>
        )}
        {raising && (
          <div className="mt-4">
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
          </div>
        )}
      </PortalSection>

      <PortalSection title="Funding">
        <div className="space-y-4">
          <div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-pale"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={project.progress.percent}
              aria-label="Pledged so far"
            >
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, project.progress.percent)}%` }}
              />
            </div>
            <p className="mt-1 text-sm text-body" data-testid="funding-progress">
              {formatPence(project.progress.pledgedGBP)} pledged of{" "}
              {formatPence(project.capitalRequiredGBP)} ·{" "}
              {formatPence(project.progress.remainingGBP)} remains ·{" "}
              {project.progress.pledgeCount} pledge
              {project.progress.pledgeCount === 1 ? "" : "s"}
            </p>
          </div>
          {project.pledge ? (
            <div
              className="rounded-lg border border-line bg-white p-4"
              data-testid="my-pledge"
            >
              <p className="text-sm text-body">
                Your pledge: <strong>{formatPence(project.pledge.amountGBP)}</strong> ·
                share {project.pledge.share} ·{" "}
                {project.pledge.status === "BINDING"
                  ? "binding (agreement signed)"
                  : "expression of interest (not yet signed)"}
              </p>
              {project.pledge.status === "PLEDGED" && (
                <div className="mt-3">
                  <ActionButton
                    action={cancelPledgeAction}
                    hidden={{ pledgeId: project.pledge.id, projectId: project.id }}
                    label="Cancel pledge"
                    tone="secondary"
                  />
                </div>
              )}
            </div>
          ) : project.status === InvestorProjectStatus.OPEN_FOR_INVESTMENT ? (
            project.kycApproved ? (
              <PledgeCalculator
                projectId={project.id}
                capital={project.capitalRequiredGBP.toString()}
                minimum={project.minimumPledgeGBP.toString()}
                pledgedSoFar={project.progress.pledgedGBP.toString()}
                expectedProfit={project.expectedProfitForCalculator?.toString() ?? null}
                showProjection={project.showProjection}
                action={pledgeAction}
              />
            ) : (
              <p className="text-sm text-muted">
                Pledging needs approved identity verification (KYC).{" "}
                <Link href="/investor/kyc" className="text-primary underline">
                  Verify now
                </Link>
              </p>
            )
          ) : (
            <p className="text-sm text-muted">
              {project.status === InvestorProjectStatus.PUBLISHED
                ? "Pledges open once the Lead Investor is confirmed."
                : "This project is not taking pledges."}
            </p>
          )}
        </div>
      </PortalSection>

      {agreements.length > 0 && (
        <PortalSection title="Your agreement">
          <AgreementList
            agreements={agreements}
            renderActions={(agreement) =>
              agreement.status === "SENT" &&
              agreement.mine?.signerStatus === "PENDING" ? (
                <ActionButton
                  action={signAgreementAction}
                  hidden={{
                    agreementId: agreement.id,
                    path: `/investor/projects/${project.id}`,
                  }}
                  label="Sign the agreement"
                />
              ) : null
            }
          />
        </PortalSection>
      )}

      {works && (
        <PortalSection title="Works and costs">
          <WorksPanel
            view={works}
            projectId={project.id}
            projectStatus={project.status}
            path={`/investor/projects/${project.id}`}
          />
        </PortalSection>
      )}

      <PortalSection title="Questions and answers">
        {member && questions ? (
          <div className="space-y-4">
            <ActionButton
              action={askQuestionAction}
              hidden={{ projectId: project.id }}
              label="Ask the agent"
            >
              <textarea
                name="body"
                required
                rows={3}
                maxLength={1000}
                aria-label="Your question"
                placeholder="Your question (answers are shared with the project's investors; your name is not)"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
              />
            </ActionButton>
            <QuestionList questions={questions} />
          </div>
        ) : (
          <p className="text-sm text-muted">
            Register your interest to read the Q&amp;A and ask questions.
          </p>
        )}
      </PortalSection>

      {member && (
        <PortalSection title="Messages">
          <p className="mb-3 text-sm text-muted">
            Project chats open once PropLink authorises them, and need an active
            subscription on both sides.
          </p>
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
          {coInvestors.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm" data-testid="co-investors">
              {coInvestors.map((co) => (
                <li key={co.investorId} className="flex flex-wrap items-center gap-3">
                  <span className="text-body">{co.label}</span>
                  <ActionButton
                    action={projectChatAction}
                    hidden={{
                      projectId: project.id,
                      with: "investor",
                      investorId: co.investorId,
                    }}
                    label="Message"
                    tone="secondary"
                  />
                </li>
              ))}
            </ul>
          )}
        </PortalSection>
      )}

      <PortalSection title="The property">
        <dl className="grid gap-4 sm:grid-cols-2" data-testid="investor-property">
          <Row label="Location" value={project.property.location} />
          <Row
            label="Landlord"
            value={project.property.landlordName ?? "Not disclosed"}
          />
          <Row
            label="Type"
            value={project.property.propertyType ?? project.property.propertyKind}
          />
          <Row
            label="Land area"
            value={
              project.property.landAreaSqm ? `${project.property.landAreaSqm} m²` : null
            }
          />
          <div className="sm:col-span-2">
            <Row
              label="Description"
              value={project.property.description ?? "Not disclosed"}
            />
          </div>
          <Row
            label="Known defects"
            value={project.property.defects ?? "Not disclosed"}
          />
          <Row
            label="Work required"
            value={project.property.requiredWork ?? "Not disclosed"}
          />
        </dl>
        {project.photos.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        )}
        <h3 className="mt-5 text-sm font-semibold text-primary">Documents</h3>
        {project.kycApproved ? (
          project.documents.length === 0 ? (
            <p className="text-sm text-muted">No documents shared.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm" data-testid="project-documents">
              {project.documents.map((url, index) => (
                <li key={url}>
                  <a
                    href={url}
                    className="text-primary underline"
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
            <Link href="/investor/kyc" className="text-primary underline">
              Verify now
            </Link>
          </p>
        )}
      </PortalSection>
    </>
  );
}
