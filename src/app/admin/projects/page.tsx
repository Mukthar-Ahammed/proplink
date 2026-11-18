import Link from "next/link";

import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import { formatPence, statusLabel } from "@/services/projects/common";
import { listAcceptedNominations } from "@/services/projects/lead";
import { allPublishableMandates, listAllProjects } from "@/services/projects/projects";

import { decideNominationAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Investor projects", robots: { index: false } };

/**
 * Investor projects (Phase 4): Lead nominations waiting for approval
 * (OD-13), every project, and mandates Admin may publish for their Agent.
 */
export default async function AdminProjectsPage() {
  const [nominations, projects, mandates] = await Promise.all([
    listAcceptedNominations(),
    listAllProjects(),
    allPublishableMandates(),
  ]);
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold text-primary">Investor projects</h1>
        <h2 className="mt-6 text-lg font-semibold text-primary">
          Lead Investor approvals
        </h2>
        {nominations.length === 0 ? (
          <p className="text-sm text-muted">No accepted nominations are waiting.</p>
        ) : (
          <ul className="mt-2 space-y-3" data-testid="lead-queue">
            {nominations.map((nomination) => (
              <li
                key={nomination.id}
                className="rounded-lg border border-line bg-white p-4"
              >
                <p className="text-sm text-body">
                  <Link
                    href={`/admin/projects/${nomination.projectId}`}
                    className="font-semibold text-primary underline"
                  >
                    {nomination.project.title}
                  </Link>{" "}
                  · Agent {nomination.project.agent.name ?? "—"} · nominee{" "}
                  {nomination.investor.name ?? "Investor"} (KYC{" "}
                  {nomination.investor.kycStatus}) · accepted{" "}
                  {day(nomination.respondedAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-4">
                  <ActionButton
                    action={decideNominationAction}
                    hidden={{
                      nominationId: nomination.id,
                      projectId: nomination.projectId,
                      decision: "approve",
                    }}
                    label="Approve as Lead"
                  />
                  <ActionButton
                    action={decideNominationAction}
                    hidden={{
                      nominationId: nomination.id,
                      projectId: nomination.projectId,
                      decision: "reject",
                    }}
                    label="Reject"
                    tone="danger"
                  >
                    <input
                      name="reason"
                      placeholder="Reason (required to reject)"
                      className="w-64 rounded-lg border border-line px-2 py-1 text-sm"
                    />
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-primary">All projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-muted">No projects yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-muted uppercase">
              <tr>
                <th className="py-2">Project</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Capital</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-t border-line">
                  <td className="py-2">
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="text-primary underline"
                    >
                      {project.title}
                    </Link>
                  </td>
                  <td>{project.agent.name ?? "—"}</td>
                  <td>{statusLabel(project.status)}</td>
                  <td>{formatPence(project.capitalRequiredGBP)}</td>
                  <td>{day(project.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-primary">Publish for an Agent</h2>
        <p className="text-sm text-muted">
          Active mandates without a project. Publishing on an Agent&apos;s behalf is
          audited.
        </p>
        <ul className="mt-2 space-y-2 text-sm">
          {mandates.map((mandate) => (
            <li key={mandate.id}>
              {mandate.listing.title} · Agent {mandate.agent.name ?? "—"} ·{" "}
              <Link
                href={`/admin/projects/new?mandate=${mandate.id}`}
                className="font-semibold text-primary underline"
              >
                Publish
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
