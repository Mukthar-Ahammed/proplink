import Link from "next/link";

import {
  ArrowIcon,
  ChartIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  StatusPill,
} from "@/components/investor/InvestorUi";
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
    <section className="space-y-5">
      <InvestorSectionTitle
        title="Projects on my"
        tail="properties"
        description="Follow the work on your property once your agent publishes it to investors. Investor identities and pledges are never shown here."
      />
      {projects.length === 0 ? (
        <InvestorEmpty title="No projects yet">
          When your agent publishes your property to investors, the project appears here.
        </InvestorEmpty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/landlord/projects/${project.id}`}
                className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <IconChip>
                      <ChartIcon />
                    </IconChip>
                    <p className="truncate font-semibold text-primary">
                      {project.listing.title}
                    </p>
                  </div>
                  <StatusPill tone="accent">{statusLabel(project.status)}</StatusPill>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
                  <span>Published {day(project.publishedAt)}</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-accent">
                    Open
                    <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
