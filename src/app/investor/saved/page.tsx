import Link from "next/link";

import { PortalEmpty, PortalSection } from "@/components/portal/PortalShell";
import { day } from "@/components/projects/format";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { formatPence, statusLabel } from "@/services/projects/common";
import { favouriteIds } from "@/services/projects/community";
import { listInvestorProjects } from "@/services/projects/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor — Saved", robots: { index: false } };

const link =
  "font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-accent";

/**
 * Everything an investor has saved in one place: projects starred (★) in the
 * Investor Portal and listings saved from the marketplace. Projects come from
 * the same visibility-filtered list as /investor/projects, so a project that
 * is no longer visible to investors never shows here.
 */
export default async function InvestorSavedPage() {
  const session = await requirePageRole(Role.INVESTOR);

  // Scoped by the viewer's own ids in the queries — never filtered after the fact.
  const [visible, starred, properties] = await Promise.all([
    listInvestorProjects({}),
    favouriteIds(session.user.authUserId),
    db.savedProperty.findMany({
      where: { userId: session.user.id },
      orderBy: { property: { createdAt: "desc" } },
      include: {
        property: { select: { id: true, title: true, city: true, askingPriceGBP: true } },
      },
    }),
  ]);
  const projects = visible.filter((project) => starred.has(project.id));

  return (
    <>
      <PortalSection title="Saved projects">
        {projects.length === 0 ? (
          <PortalEmpty>
            No saved projects yet. Open a project and press &ldquo;☆ Save&rdquo; to keep
            it here.{" "}
            <Link href="/investor/projects" className={link}>
              Browse projects
            </Link>
          </PortalEmpty>
        ) : (
          <ul className="border-t border-line" data-testid="saved-projects">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4"
              >
                <span>
                  <span className="mr-2 text-accent" aria-hidden>
                    ★
                  </span>
                  <Link href={`/investor/projects/${project.id}`} className={link}>
                    {project.title}
                  </Link>
                </span>
                <span className="text-sm text-muted">
                  {project.listing.city ?? "UK"} · {statusLabel(project.status)} ·{" "}
                  {formatPence(project.capitalRequiredGBP)} required · deadline{" "}
                  {day(project.fundingDeadline)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
      <PortalSection title="Saved properties">
        {properties.length === 0 ? (
          <PortalEmpty>
            Nothing saved yet. Save a listing from the{" "}
            <Link href="/marketplace" className={link}>
              marketplace
            </Link>{" "}
            and it appears here.
          </PortalEmpty>
        ) : (
          <ul className="border-t border-line" data-testid="saved-properties">
            {properties.map((saved) => (
              <li
                key={saved.propertyId}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4"
              >
                <Link href={`/marketplace/${saved.property.id}`} className={link}>
                  {saved.property.title}
                </Link>
                <span className="text-sm text-muted">
                  {saved.property.city} · {formatPenceGBP(saved.property.askingPriceGBP)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
    </>
  );
}
