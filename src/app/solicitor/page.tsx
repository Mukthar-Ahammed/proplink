import { isVerified, PersonName } from "@/components/profiles/PersonName";
import { PortalSection } from "@/components/portal/PortalShell";
import { ActionButton } from "@/components/projects/ActionButton";
import {
  sendAgreementAction,
  setSharesAction,
  voidAgreementAction,
} from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { ledgerView, settlementPlan } from "@/services/projects/settlement";
import { worksView } from "@/services/projects/works";
import { PledgeTable } from "@/components/projects/PledgeTable";
import { PrepareAgreementForm } from "@/components/projects/PrepareAgreementForm";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { listAgreements } from "@/services/projects/agreements";
import { listProjectPledges } from "@/services/projects/pledges";
import { getSolicitorProject } from "@/services/projects/solicitors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Solicitor — Project", robots: { index: false } };

/** The Solicitor's one project (Phase 4 Task 5). Later sections: Tasks 6-8. */
export default async function SolicitorHomePage() {
  const session = await requirePageRole(Role.SOLICITOR);
  const solicitor = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getSolicitorProject(solicitor);
  if (!project) {
    return (
      <PortalSection title="No active project">
        <p className="text-sm text-muted" data-testid="solicitor-no-project">
          Your appointment has ended, so this account no longer has access. The
          project&apos;s records remain with PropLink.
        </p>
      </PortalSection>
    );
  }
  const pledges = (await listProjectPledges(solicitor, project.id)) ?? [];
  const agreements = (await listAgreements(solicitor, project.id)) ?? [];
  const works = await worksView(solicitor, project.id);
  const [ledger, plan] = await Promise.all([
    ledgerView(solicitor, project.id),
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
  const open = agreements.some((a) => a.status === "DRAFT" || a.status === "SENT");
  const canPrepare =
    !open &&
    ["FUNDED", "IN_WORKS", "COMPLETED", "LISTED_FOR_SALE"].includes(project.status);
  return (
    <>
      <PortalSection title={project.title}>
        <p className="mb-4 text-sm text-muted">
          Agent{" "}
          <PersonName
            name={project.agent.name ?? "—"}
            verified={isVerified(project.agent)}
          />{" "}
          · Lead Investor{" "}
          {project.lead ? (
            <PersonName
              name={project.lead.name ?? "Lead Investor"}
              verified={isVerified(project.lead)}
            />
          ) : (
            "not confirmed yet"
          )}
        </p>
        <ProjectSummary project={project} showExpected />
      </PortalSection>
      <PortalSection title="Parties and pledges">
        <PledgeTable pledges={pledges} />
      </PortalSection>
      {works && (
        <PortalSection title="Funds, works and costs">
          <WorksPanel
            view={works}
            projectId={project.id}
            projectStatus={project.status}
            path="/solicitor"
            pledges={pledges
              .filter(
                (pledge) => pledge.status === "PLEDGED" || pledge.status === "BINDING",
              )
              .map((pledge) => ({
                id: pledge.id,
                label: `${pledge.investor.name ?? "Investor"} · ${pledge.share}`,
              }))}
          />
        </PortalSection>
      )}

      {ledger && (
        <PortalSection title="Sale, settlement and ledger">
          <LedgerPanel
            view={ledger}
            plan={plan}
            projectId={project.id}
            projectStatus={project.status}
            path="/solicitor"
            parties={statementParties}
          />
        </PortalSection>
      )}

      <PortalSection title="Agreements">
        <AgreementList
          agreements={agreements}
          renderActions={(agreement) =>
            agreement.status === "DRAFT" ? (
              <div className="space-y-3">
                <ActionButton
                  action={setSharesAction}
                  hidden={{ agreementId: agreement.id, path: "/solicitor" }}
                  label="Save shares"
                  tone="secondary"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {agreement.parties.map((party) => (
                      <label key={party.profileId} className="text-sm text-body">
                        {party.name} ({party.partyRole.toLowerCase()}) %
                        <input
                          name={`share:${party.profileId}`}
                          defaultValue={party.share.replace("%", "")}
                          className="ml-2 w-28 rounded-lg border border-line px-2 py-1 text-sm"
                        />
                      </label>
                    ))}
                  </div>
                </ActionButton>
                <div className="flex flex-wrap gap-4">
                  <ActionButton
                    action={sendAgreementAction}
                    hidden={{ agreementId: agreement.id, path: "/solicitor" }}
                    label="Send for signature"
                  />
                  <ActionButton
                    action={voidAgreementAction}
                    hidden={{ agreementId: agreement.id, path: "/solicitor" }}
                    label="Void draft"
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
              </div>
            ) : agreement.status === "SENT" ? (
              <ActionButton
                action={voidAgreementAction}
                hidden={{ agreementId: agreement.id, path: "/solicitor" }}
                label="Void (stop signing)"
                tone="danger"
              >
                <input
                  name="reason"
                  required
                  placeholder="Reason"
                  className="w-56 rounded-lg border border-line px-2 py-1 text-sm"
                />
              </ActionButton>
            ) : null
          }
        />
        {canPrepare && (
          <div className="mt-6 max-w-2xl">
            <h3 className="mb-2 text-sm font-semibold text-primary">
              Prepare an agreement
            </h3>
            <PrepareAgreementForm
              projectId={project.id}
              path="/solicitor"
              isJointVenture={project.mode === "DEVELOPMENT_JV"}
            />
          </div>
        )}
        {!canPrepare && !open && (
          <p className="mt-4 text-sm text-muted">
            Agreements are prepared once the project is fully pledged.
          </p>
        )}
      </PortalSection>
    </>
  );
}
