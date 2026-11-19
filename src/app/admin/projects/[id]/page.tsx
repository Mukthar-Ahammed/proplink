import Link from "next/link";
import { notFound } from "next/navigation";

import { day } from "@/components/projects/format";
import { PledgeTable } from "@/components/projects/PledgeTable";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import { requireAdminPagePermission } from "@/lib/authz";
import { ActionButton } from "@/components/projects/ActionButton";
import { QuestionList } from "@/components/projects/QuestionList";
import {
  adminAgreementAction,
  voidAgreementAction,
} from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { DecisionPanel } from "@/components/projects/DecisionPanel";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { RelistPanel } from "@/components/projects/RelistPanel";
import { retailListingFor } from "@/services/projects/relist";
import { isShortfall, listDecisions } from "@/services/projects/decisions";
import { ledgerView, settlementPlan } from "@/services/projects/settlement";
import { worksView } from "@/services/projects/works";
import { listAgreements } from "@/services/projects/agreements";
import { listProjectQuestions } from "@/services/projects/community";
import { listProjectPledges } from "@/services/projects/pledges";
import { listProjectSolicitors } from "@/services/projects/solicitors";

import { hideQuestionAction, solicitorAction } from "../actions";
import { getManagedProject } from "@/services/projects/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Investor project", robots: { index: false } };

/** One project for Admin (Phase 4). Later tasks add pledges, solicitor and ledger. */
export default async function AdminProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminPagePermission("PROJECT_OVERSIGHT");
  const { id } = await params;
  const admin = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getManagedProject(admin, id);
  if (!project) notFound();
  const pledges = (await listProjectPledges(admin, project.id)) ?? [];
  const questions = (await listProjectQuestions(admin, project.id)) ?? [];
  const solicitors = await listProjectSolicitors(project.id);
  const agreements = (await listAgreements(admin, project.id)) ?? [];
  const works = await worksView(admin, project.id);
  const decisions = await listDecisions(project.id);
  const retail = await retailListingFor(project.id);
  const sellable = ["COMPLETED", "LISTED_FOR_SALE", "SOLD"].includes(project.status);
  const closable = ["PUBLISHED", "OPEN_FOR_INVESTMENT", "FUNDED"].includes(
    project.status,
  );
  const [ledger, plan] = await Promise.all([
    ledgerView(admin, project.id),
    settlementPlan(project.id),
  ]);
  const statementParties = [
    ...new Map(
      (ledger?.entries ?? []).map((entry) => [
        entry.partyId,
        { id: entry.partyId, name: entry.party },
      ]),
    ).values(),
  ];
  const path = `/admin/projects/${project.id}`;
  const current = solicitors.find(
    (row) => row.status === "INVITED" || row.status === "ACTIVE",
  );
  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">{project.title}</h1>
        <Link
          href="/admin/projects"
          className="text-sm font-semibold text-primary underline"
        >
          All projects
        </Link>
      </div>
      <p className="text-sm text-muted">
        Agent {project.agent.name ?? "—"} · source listing &ldquo;{project.listing.title}
        &rdquo; · published {day(project.publishedAt)}
      </p>
      <ProjectSummary project={project} showExpected />
      <section>
        <h2 className="text-lg font-semibold text-primary">Lead Investor</h2>
        <p className="text-sm text-body">
          {project.lead
            ? `${project.lead.name ?? "Lead Investor"} (confirmed ${day(project.leadConfirmedAt)})`
            : "Not confirmed yet."}
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {project.nominations.map((nomination) => (
            <li key={nomination.id}>
              {nomination.investor.name ?? "Investor"} · {nomination.status} ·{" "}
              {day(nomination.nominatedAt)}
              {nomination.reason ? ` · ${nomination.reason}` : ""}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-primary">Solicitor</h2>
        <p className="text-sm text-muted">
          One Solicitor account per project, created once the Solicitor is agreed. The
          invitation expires after 7 days; MFA is required. Close the account when the
          project completes.
        </p>
        <ul className="mt-2 space-y-2 text-sm" data-testid="project-solicitors">
          {solicitors.map((row) => (
            <li key={row.id} className="rounded-lg border border-line bg-white p-3">
              <p className="text-body">
                {row.name} ({row.firm}) · {row.email} ·{" "}
                {row.expired ? "INVITATION EXPIRED" : row.status}
                {row.acceptedAt ? ` · accepted ${day(row.acceptedAt)}` : ""}
                {row.endedReason ? ` · ${row.endedReason}` : ""}
              </p>
              {(row.status === "INVITED" || row.status === "ACTIVE") && (
                <div className="mt-2 flex flex-wrap gap-4">
                  {row.status === "INVITED" && (
                    <ActionButton
                      action={solicitorAction}
                      hidden={{
                        intent: "resend",
                        solicitorId: row.id,
                        projectId: project.id,
                      }}
                      label="Re-send invitation"
                      tone="secondary"
                    />
                  )}
                  <ActionButton
                    action={solicitorAction}
                    hidden={{ intent: "end", solicitorId: row.id, projectId: project.id }}
                    label={
                      row.status === "INVITED" ? "Revoke invitation" : "Close account"
                    }
                    tone="danger"
                  >
                    <input
                      name="reason"
                      required
                      placeholder="Reason (e.g. project completed)"
                      className="w-64 rounded-lg border border-line px-2 py-1 text-sm"
                    />
                  </ActionButton>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!current && (
          <div className="mt-3 max-w-xl">
            <ActionButton
              action={solicitorAction}
              hidden={{ intent: "invite", projectId: project.id }}
              label="Invite the Solicitor"
            >
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  name="name"
                  required
                  placeholder="Solicitor's name"
                  className="rounded-lg border border-line px-2 py-1 text-sm"
                />
                <input
                  name="firm"
                  required
                  placeholder="Firm"
                  className="rounded-lg border border-line px-2 py-1 text-sm"
                />
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="Email (new to PropLink)"
                  className="rounded-lg border border-line px-2 py-1 text-sm"
                />
              </div>
            </ActionButton>
          </div>
        )}
      </section>
      {works && (
        <section>
          <h2 className="text-lg font-semibold text-primary">Works, costs and funds</h2>
          <WorksPanel
            view={works}
            projectId={project.id}
            projectStatus={project.status}
            path={path}
          />
        </section>
      )}
      {sellable && (
        <section>
          <h2 className="text-lg font-semibold text-primary">Retail sale</h2>
          <p className="mb-2 text-sm text-muted">
            Normally the project&rsquo;s Agent lists it. Listing here acts on their behalf
            (their agency, audited) and still goes to listing review.
          </p>
          <RelistPanel projectId={project.id} path={path} listing={retail} />
        </section>
      )}
      {ledger && (
        <section>
          <h2 className="text-lg font-semibold text-primary">
            Sale, ledger and corrections
          </h2>
          <LedgerPanel
            view={ledger}
            plan={plan}
            projectId={project.id}
            projectStatus={project.status}
            path={path}
            parties={statementParties}
          />
        </section>
      )}
      <section>
        <h2 className="text-lg font-semibold text-primary">Project decisions</h2>
        <DecisionPanel
          projectId={project.id}
          path={path}
          shortfall={isShortfall(project)}
          canDecide={closable}
          decisions={decisions}
        />
      </section>
      <section>
        <h2 className="text-lg font-semibold text-primary">Agreements</h2>
        <AgreementList
          agreements={agreements}
          renderActions={(agreement) =>
            agreement.status === "SENT" ? (
              <div className="flex flex-wrap gap-3">
                {agreement.parties
                  .filter((party) => party.signerStatus === "PENDING")
                  .map((party) => (
                    <ActionButton
                      key={party.profileId}
                      action={adminAgreementAction}
                      hidden={{
                        intent: "resend",
                        agreementId: agreement.id,
                        profileId: party.profileId,
                        path,
                      }}
                      label={`Re-send link to ${party.name}`}
                      tone="secondary"
                    />
                  ))}
                <ActionButton
                  action={voidAgreementAction}
                  hidden={{ agreementId: agreement.id, path }}
                  label="Void"
                  tone="danger"
                >
                  <input
                    name="reason"
                    required
                    placeholder="Reason"
                    className="w-56 rounded-lg border border-line px-2 py-1 text-sm"
                  />
                </ActionButton>
              </div>
            ) : ["EXPIRED", "DECLINED", "VOIDED"].includes(agreement.status) &&
              agreement.version === Math.max(...agreements.map((a) => a.version)) ? (
              <ActionButton
                action={adminAgreementAction}
                hidden={{ intent: "reissue", agreementId: agreement.id, path }}
                label="Re-issue and send fresh"
              />
            ) : null
          }
        />
      </section>
      <section>
        <h2 className="text-lg font-semibold text-primary">Questions and answers</h2>
        <QuestionList
          questions={questions}
          renderActions={(question) =>
            question.status === "HIDDEN" ? null : (
              <ActionButton
                action={hideQuestionAction}
                hidden={{ questionId: question.id, projectId: project.id }}
                label="Hide"
                tone="danger"
              >
                <input
                  name="reason"
                  required
                  placeholder="Reason (shown to the agent)"
                  className="w-64 rounded-lg border border-line px-2 py-1 text-sm"
                />
              </ActionButton>
            )
          }
        />
      </section>
      <section>
        <h2 className="text-lg font-semibold text-primary">Pledges</h2>
        <PledgeTable pledges={pledges} />
      </section>
    </div>
  );
}
