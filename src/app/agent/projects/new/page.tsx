import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalSection } from "@/components/portal/PortalShell";
import { ProjectTermsForm } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { PROJECT_RESPONSIBILITY_NOTICE } from "@/services/projects/common";
import { publishableMandates } from "@/services/projects/projects";

import { publishProjectAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agent — Publish to investors",
  robots: { index: false },
};

/**
 * Publish an active mandate to the Investor Portal (Phase 4 Task 1, TRD
 * AG-5; acceptance criterion 5). Investors see only what the mandate's
 * disclosure allows (ADR-040).
 */
export default async function PublishProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ mandate?: string }>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const { mandate: mandateId } = await searchParams;
  const mandates = await publishableMandates({
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  });
  const mandate = mandates.find((candidate) => candidate.id === mandateId);
  if (!mandate) notFound();
  return (
    <PortalSection
      title={`Publish: ${mandate.listing.title}`}
      action={
        <Link
          href={`/agent/mandates/${mandate.id}`}
          className="text-sm font-semibold text-primary underline"
        >
          Choose what investors see
        </Link>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Investors see your title and summary, these terms, and only the property details
        you ticked on the mandate. The project waits for its Lead Investor before
        co-investors can pledge.
      </p>
      <ProjectTermsForm
        action={publishProjectAction}
        hidden={{ mandateId: mandate.id }}
        submitLabel="Publish to the Investor Portal"
        notice={PROJECT_RESPONSIBILITY_NOTICE}
      />
    </PortalSection>
  );
}
