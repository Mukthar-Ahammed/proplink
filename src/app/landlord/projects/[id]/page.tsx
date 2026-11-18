import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalSection } from "@/components/portal/PortalShell";
import { day } from "@/components/projects/format";
import { Lifecycle } from "@/components/projects/ProjectSummary";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { formatPence, PROJECT_RESPONSIBILITY_NOTICE } from "@/services/projects/common";
import { getLandlordProject } from "@/services/projects/landlordView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Landlord — Project", robots: { index: false } };

/**
 * The Landlord's project view (Phase 4 Task 3a): the lifecycle and progress
 * of the project on their property. No investor identities, individual
 * pledges or private profiles are ever shown here.
 */
export default async function LandlordProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.LANDLORD);
  const { id } = await params;
  const project = await getLandlordProject(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    id,
  );
  if (!project) notFound();
  return (
    <PortalSection
      title={project.listing.title}
      action={
        <Link
          href="/landlord/projects"
          className="text-sm font-semibold text-primary underline"
        >
          All projects
        </Link>
      }
    >
      <div className="space-y-4" data-testid="landlord-project">
        <Lifecycle status={project.status} />
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Project type
            </dt>
            <dd className="mt-0.5 text-sm text-body">
              {project.mode === "DEVELOPMENT_JV"
                ? "Development joint venture (you are a party where the agreement names you)"
                : "Refurbishment / build"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Agent
            </dt>
            <dd className="mt-0.5 text-sm text-body">
              {project.agent.name ?? "Your agent"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Capital to raise
            </dt>
            <dd className="mt-0.5 text-sm text-body">
              {formatPence(project.capitalRequiredGBP)} ·{" "}
              {project.funded
                ? "fully funded"
                : `funding by ${day(project.fundingDeadline)}`}
            </dd>
          </div>
        </dl>
        {project.closedReason && (
          <p className="text-sm text-warning">Closed: {project.closedReason}</p>
        )}
        <p className="rounded-lg border border-line bg-surface p-3 text-xs text-muted">
          {PROJECT_RESPONSIBILITY_NOTICE}
        </p>
      </div>
    </PortalSection>
  );
}
