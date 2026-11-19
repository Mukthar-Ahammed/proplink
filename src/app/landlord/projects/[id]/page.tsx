import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AlertIcon,
  ArrowIcon,
  ChartIcon,
  IconChip,
  InvestorSectionTitle,
  ScaleIcon,
  StatStrip,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { day } from "@/components/projects/format";
import { ActionButton } from "@/components/projects/ActionButton";
import { signAgreementAction } from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { ledgerView } from "@/services/projects/settlement";
import { worksView } from "@/services/projects/works";
import { Lifecycle } from "@/components/projects/ProjectSummary";
import { listAgreements } from "@/services/projects/agreements";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import {
  formatPence,
  PROJECT_RESPONSIBILITY_NOTICE,
  statusLabel,
} from "@/services/projects/common";
import { getLandlordProject } from "@/services/projects/landlordView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Landlord — Project", robots: { index: false } };

const CARD = "rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7";

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
  const landlord = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getLandlordProject(landlord, id);
  if (!project) notFound();
  // OD-14: only agreements that name the Landlord, with only their own row.
  const agreements = (await listAgreements(landlord, project.id)) ?? [];
  // Task 3a: milestones, itemised costs and updates addressed to the Landlord.
  const works = await worksView(landlord, project.id);
  const [ledger, plan] = await Promise.all([
    ledgerView(landlord, project.id),
    // Only the Solicitor sees the settlement plan (every party's amounts).
    Promise.resolve(null),
  ]);
  const path = `/landlord/projects/${project.id}`;

  return (
    <div className="space-y-10" data-testid="landlord-project">
      <div className="space-y-4">
        <Link
          href="/landlord/projects"
          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
        >
          <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
          All projects
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <IconChip>
            <ChartIcon />
          </IconChip>
          <h2 className="font-display text-2xl leading-tight font-semibold tracking-[-0.02em] text-primary sm:text-[1.75rem]">
            {project.listing.title}
          </h2>
          <StatusPill tone="accent">{statusLabel(project.status)}</StatusPill>
        </div>
      </div>

      <div className={CARD}>
        <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Where the project is
        </p>
        <Lifecycle status={project.status} />
        {project.closedReason && (
          <p className="mt-4 flex items-start gap-2.5 text-sm text-warning">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            Closed: {project.closedReason}
          </p>
        )}
      </div>

      <StatStrip
        items={[
          {
            value: project.mode === "DEVELOPMENT_JV" ? "Development JV" : "Refurbishment",
            label: "Project type",
            hint:
              project.mode === "DEVELOPMENT_JV"
                ? "You are a party where the agreement names you"
                : "Refurbishment / build",
          },
          { value: project.agent.name ?? "Your agent", label: "Agent" },
          {
            value: formatPence(project.capitalRequiredGBP),
            label: "Capital to raise",
            hint: project.funded
              ? "Fully funded"
              : `Funding by ${day(project.fundingDeadline)}`,
          },
        ]}
      />

      <div className="flex items-start gap-3 rounded-3xl border border-accent/20 bg-pale/70 p-5 sm:p-6">
        <IconChip>
          <ScaleIcon />
        </IconChip>
        <p className="text-sm leading-relaxed text-body">
          {PROJECT_RESPONSIBILITY_NOTICE}
        </p>
      </div>

      {works && (
        <section className="space-y-5">
          <InvestorSectionTitle
            title="Works and"
            tail="updates"
            description="Milestones, itemised costs and updates addressed to you."
          />
          <div className={CARD}>
            <WorksPanel
              view={works}
              projectId={project.id}
              projectStatus={project.status}
              path={path}
            />
          </div>
        </section>
      )}

      {ledger && (
        <section className="space-y-5">
          <InvestorSectionTitle
            title="Sale and"
            tail="settlement"
            description="Recorded by the project Solicitor. PropLink never holds or moves the money."
          />
          <div className={CARD}>
            <LedgerPanel
              view={ledger}
              plan={plan}
              projectId={project.id}
              projectStatus={project.status}
              path={path}
            />
          </div>
        </section>
      )}

      {agreements.length > 0 && (
        <section className="space-y-5">
          <InvestorSectionTitle title="Your" tail="agreement" />
          <AgreementList
            agreements={agreements}
            renderActions={(agreement) =>
              agreement.status === "SENT" &&
              agreement.mine?.signerStatus === "PENDING" ? (
                <ActionButton
                  action={signAgreementAction}
                  hidden={{ agreementId: agreement.id, path }}
                  label="Sign the agreement"
                />
              ) : null
            }
          />
        </section>
      )}
    </div>
  );
}
