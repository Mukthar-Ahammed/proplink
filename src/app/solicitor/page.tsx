import { PortalSection } from "@/components/portal/PortalShell";
import { PledgeTable } from "@/components/projects/PledgeTable";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
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
  return (
    <>
      <PortalSection title={project.title}>
        <p className="mb-4 text-sm text-muted">
          Agent {project.agent.name ?? "—"} · Lead Investor{" "}
          {project.lead?.name ?? "not confirmed yet"}
        </p>
        <ProjectSummary project={project} showExpected />
      </PortalSection>
      <PortalSection title="Parties and pledges">
        <PledgeTable pledges={pledges} />
      </PortalSection>
    </>
  );
}
