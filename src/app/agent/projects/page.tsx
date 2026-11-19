import Link from "next/link";

import { PortalSection } from "@/components/portal/PortalShell";
import { day } from "@/components/projects/format";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { formatPence, statusLabel } from "@/services/projects/common";
import { listAgentProjects, publishableMandates } from "@/services/projects/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Investor projects", robots: { index: false } };

/** The Agent's investor projects and mandates ready to publish (Phase 4 Task 1). */
export default async function AgentProjectsPage() {
  const session = await requirePageRole(Role.AGENT);
  const agent = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const [projects, mandates] = await Promise.all([
    listAgentProjects(agent),
    publishableMandates(agent),
  ]);
  return (
    <>
      <PortalSection title="Investor projects">
        {projects.length === 0 ? (
          <p className="text-sm text-muted">
            No projects yet. Publish an active mandate to the Investor Portal below.
          </p>
        ) : (
          <ul className="space-y-3">
            {projects.map((project) => (
              <li key={project.id} className="rounded-lg border border-line bg-white p-4">
                <Link
                  href={`/agent/projects/${project.id}`}
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {project.title}
                </Link>
                <p className="text-sm text-muted">
                  {statusLabel(project.status)} ·{" "}
                  {formatPence(project.capitalRequiredGBP)} required · deadline{" "}
                  {day(project.fundingDeadline)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
      <PortalSection title="Ready to publish">
        {mandates.length === 0 ? (
          <p className="text-sm text-muted">
            Active mandates without a project appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {mandates.map((mandate) => (
              <li key={mandate.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-body">
                  {mandate.listing.title}
                  {mandate.listing.city ? ` · ${mandate.listing.city}` : ""}
                </span>
                <Link
                  href={`/agent/projects/new?mandate=${mandate.id}`}
                  className="font-semibold text-primary underline"
                >
                  Publish to investors
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
    </>
  );
}
