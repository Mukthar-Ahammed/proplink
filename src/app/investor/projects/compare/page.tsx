import Link from "next/link";

import { PortalSection } from "@/components/portal/PortalShell";
import { day } from "@/components/projects/format";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { compareProjects } from "@/services/projects/community";
import { formatPence, statusLabel } from "@/services/projects/common";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Investor — Compare projects",
  robots: { index: false },
};

/** Compare up to four projects side by side (Phase 4 Task 3). */
export default async function CompareProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const session = await requirePageRole(Role.INVESTOR);
  const { id } = await searchParams;
  const projects = await compareProjects(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    id,
  );
  const showExpected = projects.some(
    (project) => project.expectedProfitGBP !== null || project.expectedMonths !== null,
  );
  const rows: { label: string; value: (p: (typeof projects)[number]) => string }[] = [
    { label: "Town", value: (p) => p.city ?? "—" },
    { label: "Stage", value: (p) => statusLabel(p.status) },
    {
      label: "Type",
      value: (p) =>
        p.mode === "DEVELOPMENT_JV" ? "Development JV" : "Refurbishment / build",
    },
    { label: "Capital required", value: (p) => formatPence(p.capitalRequiredGBP) },
    { label: "Pledged so far", value: (p) => formatPence(p.progress.pledgedGBP) },
    { label: "Remaining", value: (p) => formatPence(p.progress.remainingGBP) },
    { label: "Minimum pledge", value: (p) => formatPence(p.minimumPledgeGBP) },
    { label: "Funding deadline", value: (p) => day(p.fundingDeadline) },
    { label: "Purchase amount", value: (p) => formatPence(p.purchaseGBP) },
    { label: "Market value", value: (p) => formatPence(p.marketValueGBP) },
    ...(showExpected
      ? [
          {
            label: "Expected profit (estimate)",
            value: (p: (typeof projects)[number]) =>
              p.expectedProfitGBP === null ? "—" : formatPence(p.expectedProfitGBP),
          },
          {
            label: "Expected time",
            value: (p: (typeof projects)[number]) =>
              p.expectedMonths ? `${p.expectedMonths} months` : "—",
          },
        ]
      : []),
  ];
  return (
    <PortalSection
      title="Compare projects"
      action={
        <Link
          href="/investor/projects"
          className="text-sm font-semibold text-primary underline"
        >
          All projects
        </Link>
      }
    >
      {projects.length === 0 ? (
        <p className="text-sm text-muted">Choose projects to compare from the list.</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[32rem] text-left text-sm"
            data-testid="compare-table"
          >
            <thead>
              <tr>
                <th className="py-2 text-xs text-muted uppercase">Project</th>
                {projects.map((project) => (
                  <th key={project.id} className="py-2 pr-4 font-semibold text-primary">
                    <Link href={`/investor/projects/${project.id}`} className="underline">
                      {project.title}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-line">
                  <th className="py-2 pr-4 text-xs font-medium text-muted uppercase">
                    {row.label}
                  </th>
                  {projects.map((project) => (
                    <td key={project.id} className="py-2 pr-4 text-body">
                      {row.value(project)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalSection>
  );
}
