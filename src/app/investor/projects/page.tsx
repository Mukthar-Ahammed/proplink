import Link from "next/link";

import { PortalSection } from "@/components/portal/PortalShell";
import { day } from "@/components/projects/format";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { formatPence, statusLabel } from "@/services/projects/common";
import { listInvestorProjects } from "@/services/projects/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor — Projects", robots: { index: false } };

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-body";

/** Investor Portal: browse and search projects (Phase 4 Tasks 1 and 3). */
export default async function InvestorProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePageRole(Role.INVESTOR);
  const params = await searchParams;
  const projects = await listInvestorProjects(params);
  return (
    <PortalSection title="Investment projects">
      <form className="mb-5 flex flex-wrap items-end gap-3" role="search">
        <label className="text-sm text-primary">
          Search
          <input name="q" defaultValue={params.q} className={`${input} mt-1 block`} />
        </label>
        <label className="text-sm text-primary">
          Town
          <input
            name="city"
            defaultValue={params.city}
            className={`${input} mt-1 block`}
          />
        </label>
        <label className="text-sm text-primary">
          Stage
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className={`${input} mt-1 block`}
          >
            <option value="">Any</option>
            <option value="PUBLISHED">Published (Lead pending)</option>
            <option value="OPEN_FOR_INVESTMENT">Open for investment</option>
            <option value="FUNDED">Funded</option>
            <option value="IN_WORKS">In works</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
        <label className="text-sm text-primary">
          Type
          <select
            name="mode"
            defaultValue={params.mode ?? ""}
            className={`${input} mt-1 block`}
          >
            <option value="">Any</option>
            <option value="REFURBISHMENT">Refurbishment / build</option>
            <option value="DEVELOPMENT_JV">Development JV</option>
          </select>
        </label>
        <label className="text-sm text-primary">
          Minimum pledge up to (£)
          <input
            name="maxMinimum"
            inputMode="numeric"
            defaultValue={params.maxMinimum}
            className={`${input} mt-1 block w-32`}
          />
        </label>
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
          Filter
        </button>
      </form>
      {projects.length === 0 ? (
        <p className="text-sm text-muted">No projects match.</p>
      ) : (
        <ul className="space-y-3" data-testid="project-list">
          {projects.map((project) => (
            <li key={project.id} className="rounded-lg border border-line bg-white p-4">
              <Link
                href={`/investor/projects/${project.id}`}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {project.title}
              </Link>
              <p className="text-sm text-muted">
                {project.listing.city ?? "UK"} · {statusLabel(project.status)} ·{" "}
                {formatPence(project.capitalRequiredGBP)} required · minimum{" "}
                {formatPence(project.minimumPledgeGBP)} · deadline{" "}
                {day(project.fundingDeadline)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PortalSection>
  );
}
