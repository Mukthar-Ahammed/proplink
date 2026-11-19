import Link from "next/link";

import {
  ArrowIcon,
  ChartIcon,
  FileIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { day } from "@/components/projects/format";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { formatPence, statusLabel } from "@/services/projects/common";
import { listAgentProjects, publishableMandates } from "@/services/projects/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Investor projects", robots: { index: false } };

/** Pill tone for a project's stage (presentational only). */
function statusTone(status: string): "accent" | "success" | "neutral" | "warning" {
  if (status === "CLOSED") return "neutral";
  if (status === "SOLD" || status === "COMPLETED" || status === "FUNDED")
    return "success";
  return "accent";
}

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
    <div className="space-y-12">
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Investor"
          tail="projects"
          description="Projects you have published to verified investors, and where each one stands."
        />
        {projects.length === 0 ? (
          <InvestorEmpty title="No projects yet">
            Publish an active mandate to the Investor Portal below.
          </InvestorEmpty>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/agent/projects/${project.id}`}
                  className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <IconChip>
                        <ChartIcon />
                      </IconChip>
                      <p className="min-w-0 font-semibold break-words text-primary">
                        {project.title}
                      </p>
                    </div>
                    <StatusPill tone={statusTone(project.status)}>
                      {statusLabel(project.status)}
                    </StatusPill>
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
                    <div>
                      <dt className="text-xs text-muted">Capital required</dt>
                      <dd className="mt-0.5 font-semibold text-primary tabular-nums">
                        {formatPence(project.capitalRequiredGBP)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Funding deadline</dt>
                      <dd className="mt-0.5 font-semibold text-primary tabular-nums">
                        {day(project.fundingDeadline)}
                      </dd>
                    </div>
                  </dl>
                  <span className="mt-4 inline-flex items-center gap-1 self-end text-xs font-semibold text-accent">
                    Manage
                    <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle
          title="Ready to"
          tail="publish"
          description="Active mandates that do not have an investor project yet."
        />
        {mandates.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-8 text-center text-sm text-muted">
            Active mandates without a project appear here.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
            {mandates.map((mandate) => (
              <li
                key={mandate.id}
                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <IconChip>
                    <FileIcon />
                  </IconChip>
                  <div className="min-w-0">
                    <p className="font-semibold break-words text-primary">
                      {mandate.listing.title}
                    </p>
                    {mandate.listing.city ? (
                      <p className="mt-0.5 text-sm text-muted">{mandate.listing.city}</p>
                    ) : null}
                  </div>
                </div>
                <Link
                  href={`/agent/projects/new?mandate=${mandate.id}`}
                  className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 sm:self-auto"
                >
                  Publish to investors
                  <ArrowIcon className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
