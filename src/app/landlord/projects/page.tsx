import Link from "next/link";

import { PortalSection } from "@/components/portal/PortalShell";
import { day } from "@/components/projects/format";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { statusLabel } from "@/services/projects/common";
import { listLandlordProjects } from "@/services/projects/landlordView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Landlord — Projects", robots: { index: false } };

/** Projects built on the Landlord's listings (Phase 4 Task 3a). */
export default async function LandlordProjectsPage() {
  const session = await requirePageRole(Role.LANDLORD);
  const projects = await listLandlordProjects({
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  });
  return (
    <PortalSection title="Projects on my properties">
      {projects.length === 0 ? (
        <p className="text-sm text-muted">
          When your agent publishes your property to investors, the project appears here.
        </p>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li key={project.id} className="rounded-lg border border-line bg-white p-4">
              <Link
                href={`/landlord/projects/${project.id}`}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {project.listing.title}
              </Link>
              <p className="text-sm text-muted">
                {statusLabel(project.status)} · published {day(project.publishedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PortalSection>
  );
}
