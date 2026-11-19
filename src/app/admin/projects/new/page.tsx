import { notFound } from "next/navigation";

import { ProjectTermsForm } from "@/components/projects/ProjectTermsForm";
import { requireAdminPagePermission } from "@/lib/authz";
import { PROJECT_RESPONSIBILITY_NOTICE } from "@/services/projects/common";
import { allPublishableMandates } from "@/services/projects/projects";

import { adminPublishProjectAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Publish for an Agent",
  robots: { index: false },
};

/** TRD matrix: Admin publishes on the mandated Agent's behalf (audited). */
export default async function AdminPublishPage({
  searchParams,
}: {
  searchParams: Promise<{ mandate?: string }>;
}) {
  // Phase 6 (ADR-058): checked here, not only by the Admin layout.
  await requireAdminPagePermission("PROJECT_OVERSIGHT");
  const { mandate: mandateId } = await searchParams;
  const mandate = (await allPublishableMandates()).find(
    (candidate) => candidate.id === mandateId,
  );
  if (!mandate) notFound();
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold text-primary">
        Publish for {mandate.agent.name ?? "the Agent"}: {mandate.listing.title}
      </h1>
      <p className="text-sm text-muted">
        The project belongs to the mandated Agent; your action is recorded in the audit
        log.
      </p>
      <ProjectTermsForm
        action={adminPublishProjectAction}
        hidden={{ mandateId: mandate.id }}
        submitLabel="Publish on the Agent's behalf"
        notice={PROJECT_RESPONSIBILITY_NOTICE}
      />
    </div>
  );
}
