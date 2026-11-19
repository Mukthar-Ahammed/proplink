import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArrowIcon,
  ArrowLink,
  ChartIcon,
  IconChip,
} from "@/components/investor/InvestorUi";
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
    <div className="space-y-8">
      <div className="space-y-4">
        <Link
          href="/agent/projects"
          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
        >
          <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <IconChip>
              <ChartIcon />
            </IconChip>
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                Publish to investors
              </p>
              <h2 className="font-display mt-0.5 text-2xl leading-tight font-semibold tracking-[-0.02em] break-words text-primary sm:text-[1.75rem]">
                {`Publish: ${mandate.listing.title}`}
              </h2>
            </div>
          </div>
          <ArrowLink href={`/agent/mandates/${mandate.id}`}>
            Choose what investors see
          </ArrowLink>
        </div>
      </div>

      <div className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7">
        <p className="mb-6 rounded-2xl border border-accent/20 bg-pale/70 p-4 text-sm leading-relaxed text-body">
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
      </div>
    </div>
  );
}
