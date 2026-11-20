import { isVerified, PersonName } from "@/components/profiles/PersonName";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AlertIcon, IconChip, ScaleIcon } from "@/components/investor/InvestorUi";
import {
  DetailColumns,
  DetailHeader,
  DetailTabs,
  FactList,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { day } from "@/components/projects/format";
import { ActionButton } from "@/components/projects/ActionButton";
import { signAgreementAction } from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { Lifecycle } from "@/components/projects/ProjectSummary";
import { Badge } from "@/components/ui/badge";
import { ledgerView } from "@/services/projects/settlement";
import { worksView } from "@/services/projects/works";
import { listAgreements } from "@/services/projects/agreements";
import { InvestorProjectStatus, Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import {
  formatPence,
  PROJECT_RESPONSIBILITY_NOTICE,
  statusLabel,
} from "@/services/projects/common";
import { getLandlordProject } from "@/services/projects/landlordView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Landlord — Project", robots: { index: false } };

/**
 * The Landlord's project view (Phase 4 Task 3a), split into tabs (ADR-080):
 * Overview · Works & updates · Sale & settlement · Your agreement. No investor
 * identities, individual pledges or private profiles are ever shown here.
 */
export default async function LandlordProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requirePageRole(Role.LANDLORD);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const landlord = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getLandlordProject(landlord, id);
  if (!project) notFound();
  const [agreementList, works, ledger] = await Promise.all([
    // OD-14: only agreements that name the Landlord, with only their own row.
    listAgreements(landlord, project.id),
    // Task 3a: milestones, itemised costs and updates addressed to the Landlord.
    worksView(landlord, project.id),
    ledgerView(landlord, project.id),
  ]);
  const agreements = agreementList ?? [];
  const path = `/landlord/projects/${project.id}`;
  const closed = project.status === InvestorProjectStatus.CLOSED;
  const toSign = agreements.some(
    (agreement) =>
      agreement.status === "SENT" && agreement.mine?.signerStatus === "PENDING",
  );
  const modeLabel =
    project.mode === "DEVELOPMENT_JV" ? "Development joint venture" : "Refurbishment";

  const tabs: DetailTab[] = [{ key: "overview", label: "Overview" }];
  if (agreements.length > 0) {
    tabs.push({ key: "agreement", label: "Your agreement", attention: toSign });
  }
  if (works) tabs.push({ key: "works", label: "Works & updates" });
  if (ledger) tabs.push({ key: "sale", label: "Sale & settlement" });
  const tab = pickTab(query.tab, tabs);

  return (
    <div data-testid="landlord-project">
      <DetailHeader
        back={{ href: "/landlord/projects", label: "All projects" }}
        eyebrow={modeLabel}
        title={project.listing.title}
        badges={
          <>
            <Badge tone={closed ? "warning" : "intel"}>
              {statusLabel(project.status)}
            </Badge>
            {project.funded ? <Badge tone="success">Fully funded</Badge> : null}
            {toSign ? <Badge tone="warning">Agreement to sign</Badge> : null}
          </>
        }
      />

      <KeyFacts
        items={[
          {
            label: "Project type",
            value: project.mode === "DEVELOPMENT_JV" ? "Development JV" : "Refurbishment",
          },
          {
            label: "Agent",
            value: (
              <PersonName
                name={project.agent.name ?? "Your agent"}
                verified={isVerified(project.agent)}
              />
            ),
          },
          { label: "Capital to raise", value: formatPence(project.capitalRequiredGBP) },
          {
            label: "Funding",
            value: project.funded ? "Fully funded" : day(project.fundingDeadline),
            hint: project.funded ? undefined : "Funding deadline",
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Project sections" />

      {tab === "overview" && (
        <TabBody>
          <DetailColumns
            main={
              <>
                <Panel title="Where the project is">
                  <Lifecycle status={project.status} />
                  {project.closedReason && (
                    <p className="mt-4 flex items-start gap-2.5 text-sm text-warning">
                      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      Closed: {project.closedReason}
                    </p>
                  )}
                </Panel>
                <Panel title="The project">
                  <FactList
                    items={[
                      { label: "Type", value: modeLabel },
                      {
                        label: "Your role",
                        value:
                          project.mode === "DEVELOPMENT_JV"
                            ? "You are a party where the agreement names you"
                            : "Property owner",
                      },
                      {
                        label: "Agent",
                        value: (
                          <PersonName
                            name={project.agent.name ?? "Your agent"}
                            verified={isVerified(project.agent)}
                          />
                        ),
                      },
                      {
                        label: "Capital to raise",
                        value: formatPence(project.capitalRequiredGBP),
                      },
                      {
                        label: "Funding deadline",
                        value: day(project.fundingDeadline),
                      },
                      { label: "Status", value: statusLabel(project.status) },
                    ]}
                  />
                </Panel>
              </>
            }
            side={
              <>
                {toSign && (
                  <Panel
                    title="Agreement to sign"
                    tone="attention"
                    description="An agreement that names you is waiting for your signature."
                  >
                    <Link
                      href={`${path}?tab=agreement`}
                      className="inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong"
                    >
                      Review and sign
                    </Link>
                  </Panel>
                )}
                <div className="flex items-start gap-3 rounded-2xl border border-accent/20 bg-pale/70 p-5">
                  <IconChip>
                    <ScaleIcon />
                  </IconChip>
                  <p className="text-sm leading-relaxed text-body">
                    {PROJECT_RESPONSIBILITY_NOTICE}
                  </p>
                </div>
              </>
            }
          />
        </TabBody>
      )}

      {tab === "agreement" && (
        <TabBody>
          <Panel title="Your agreement" tone={toSign ? "attention" : "default"}>
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
          </Panel>
        </TabBody>
      )}

      {tab === "works" && works && (
        <TabBody>
          <Panel
            title="Works and updates"
            description="Milestones, itemised costs and updates addressed to you."
          >
            <WorksPanel
              view={works}
              projectId={project.id}
              projectStatus={project.status}
              path={path}
            />
          </Panel>
        </TabBody>
      )}

      {tab === "sale" && ledger && (
        <TabBody>
          <Panel
            title="Sale and settlement"
            description="Recorded by the project Solicitor. PropLink never holds or moves the money."
          >
            <LedgerPanel
              view={ledger}
              // Only the Solicitor sees the settlement plan (every party's amounts).
              plan={null}
              projectId={project.id}
              projectStatus={project.status}
              path={path}
            />
          </Panel>
        </TabBody>
      )}
    </div>
  );
}
