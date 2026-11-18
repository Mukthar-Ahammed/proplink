import Link from "next/link";
import { notFound } from "next/navigation";

import { day } from "@/components/projects/format";
import { PledgeTable } from "@/components/projects/PledgeTable";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import { requirePageRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { listProjectPledges } from "@/services/projects/pledges";
import { getManagedProject } from "@/services/projects/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Investor project", robots: { index: false } };

/** One project for Admin (Phase 4). Later tasks add pledges, solicitor and ledger. */
export default async function AdminProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.ADMIN);
  const { id } = await params;
  const admin = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getManagedProject(admin, id);
  if (!project) notFound();
  const pledges = (await listProjectPledges(admin, project.id)) ?? [];
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
        <h2 className="text-lg font-semibold text-primary">Pledges</h2>
        <PledgeTable pledges={pledges} />
      </section>
    </div>
  );
}
