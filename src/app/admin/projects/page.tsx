import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  DetailTabs,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { ActionButton } from "@/components/projects/ActionButton";
import { requireAdminPagePermission } from "@/lib/authz";
import { day } from "@/components/projects/format";
import { formatPence, statusLabel } from "@/services/projects/common";
import { shortfallProjects } from "@/services/projects/decisions";
import { listAcceptedNominations } from "@/services/projects/lead";
import { allPublishableMandates, listAllProjects } from "@/services/projects/projects";

import { decideNominationAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Investor projects", robots: { index: false } };

/**
 * Investor projects (Phase 4): Lead nominations waiting for approval
 * (OD-13), every project, and mandates Admin may publish for their Agent.
 */
export default async function AdminProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // Phase 6 (ADR-058): checked here, not only by the Admin layout.
  await requireAdminPagePermission("PROJECT_OVERSIGHT");
  const [nominations, projects, mandates, shortfall] = await Promise.all([
    listAcceptedNominations(),
    listAllProjects(),
    allPublishableMandates(),
    shortfallProjects(),
  ]);
  const tabs: DetailTab[] = [
    {
      key: "approvals",
      label: "Lead approvals",
      count: nominations.length,
      attention: nominations.length > 0,
    },
  ];
  if (shortfall.length > 0) {
    tabs.push({
      key: "deadline",
      label: "Past deadline",
      count: shortfall.length,
      attention: true,
    });
  }
  tabs.push(
    { key: "all", label: "All projects", count: projects.length },
    { key: "publish", label: "Publish for an Agent", count: mandates.length },
  );
  const tab = pickTab((await searchParams).tab, tabs);
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Investor projects"
        description="Approve Lead Investors, watch funding deadlines, and publish projects for Agents."
      />
      <KeyFacts
        items={[
          { label: "Lead approvals waiting", value: nominations.length },
          { label: "Past the funding deadline", value: shortfall.length },
          { label: "All projects", value: projects.length },
          { label: "Mandates ready to publish", value: mandates.length },
        ]}
      />
      <DetailTabs
        basePath="/admin/projects"
        tabs={tabs}
        current={tab}
        label="Project sections"
      />
      {tab === "approvals" && (
        <TabBody>
          <Panel
            title="Lead Investor approvals"
            description="Investors who accepted an Agent's Lead nomination. Approving confirms them and opens the project for pledges."
            tone={nominations.length > 0 ? "attention" : "default"}
          >
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
          </Panel>
        </TabBody>
      )}

      {tab === "deadline" && (
        <TabBody>
          <Panel
            title="Past the funding deadline"
            description="Projects that did not raise enough in time. Open one to see the decision it needs."
            tone="attention"
          >
            <ul className="divide-y divide-line text-sm" data-testid="shortfall">
              {shortfall.map((project) => (
                <li key={project.id} className="py-2">
                  <Link
                    href={`/admin/projects/${project.id}`}
                    className="text-primary underline"
                  >
                    {project.title}
                  </Link>{" "}
                  · deadline {day(project.fundingDeadline)} ·{" "}
                  {statusLabel(project.status)}
                </li>
              ))}
            </ul>
          </Panel>
        </TabBody>
      )}

      {tab === "all" && (
        <TabBody>
          <Panel
            title="All projects"
            description="Every investor project, newest first. Open one for its Lead, pledges, works and sale."
          >
            {projects.length === 0 ? (
              <p className="text-sm text-muted">No projects yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
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
              </div>
            )}
          </Panel>
        </TabBody>
      )}

      {tab === "publish" && (
        <TabBody>
          <Panel
            title="Publish for an Agent"
            description="Active mandates without a project. Publishing on an Agent's behalf is audited."
          >
            {mandates.length === 0 ? (
              <p className="text-sm text-muted">No mandates are waiting for a project.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {mandates.map((mandate) => (
                  <li key={mandate.id} className="py-2">
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
            )}
          </Panel>
        </TabBody>
      )}
    </div>
  );
}
