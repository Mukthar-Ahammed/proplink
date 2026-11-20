import Link from "next/link";
import { notFound } from "next/navigation";

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
import { ActionButton } from "@/components/projects/ActionButton";
import {
  adminAgreementAction,
  voidAgreementAction,
} from "@/components/projects/agreementActions";
import { AgreementList } from "@/components/projects/AgreementList";
import { DecisionPanel } from "@/components/projects/DecisionPanel";
import { day } from "@/components/projects/format";
import { LedgerPanel } from "@/components/projects/LedgerPanel";
import { PledgeTable } from "@/components/projects/PledgeTable";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import { RelistPanel } from "@/components/projects/RelistPanel";
import { WorksPanel } from "@/components/projects/WorksPanel";
import { Badge } from "@/components/ui/badge";
import { requireAdminPagePermission } from "@/lib/authz";
import { listAgreements } from "@/services/projects/agreements";
import { formatPence, statusLabel } from "@/services/projects/common";
import { isShortfall, listDecisions } from "@/services/projects/decisions";
import { listProjectPledges } from "@/services/projects/pledges";
import { getManagedProject } from "@/services/projects/projects";
import { retailListingFor } from "@/services/projects/relist";
import { ledgerView, settlementPlan } from "@/services/projects/settlement";
import { listProjectSolicitors } from "@/services/projects/solicitors";
import { worksView } from "@/services/projects/works";

import { solicitorAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Investor project", robots: { index: false } };

const LIVE_PLEDGE = new Set(["PLEDGED", "BINDING"]);
const INPUT = "rounded-lg border border-line px-2 py-1 text-sm";

/**
 * One project for Admin (Phase 4), in tabs (ADR-080): Overview · Pledges ·
 * Solicitor · Agreements · Works & sale · Decisions.
 */
export default async function AdminProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireAdminPagePermission("PROJECT_OVERSIGHT");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const admin = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const project = await getManagedProject(admin, id);
  if (!project) notFound();
  const [pledgeList, solicitors, agreementList, works, decisions, retail, ledger, plan] =
    await Promise.all([
      listProjectPledges(admin, project.id),
      listProjectSolicitors(project.id),
      listAgreements(admin, project.id),
      worksView(admin, project.id),
      listDecisions(project.id),
      retailListingFor(project.id),
      ledgerView(admin, project.id),
      settlementPlan(project.id),
    ]);
  const pledges = pledgeList ?? [];
  const agreements = agreementList ?? [];
  const sellable = ["COMPLETED", "LISTED_FOR_SALE", "SOLD"].includes(project.status);
  const closable = ["PUBLISHED", "OPEN_FOR_INVESTMENT", "FUNDED"].includes(
    project.status,
  );
  const shortfall = isShortfall(project);
  const statementParties = [
    ...new Map(
      (ledger?.entries ?? []).map((entry) => [
        entry.partyId,
        { id: entry.partyId, name: entry.party },
      ]),
    ).values(),
  ];
  const path = `/admin/projects/${project.id}`;
  const current = solicitors.find(
    (row) => row.status === "INVITED" || row.status === "ACTIVE",
  );
  const livePledges = pledges.filter((pledge) => LIVE_PLEDGE.has(pledge.status));
  const pledged = livePledges.reduce((sum, pledge) => sum + pledge.amountGBP, BigInt(0));
  const percent =
    project.capitalRequiredGBP > BigInt(0)
      ? Number((pledged * BigInt(1000)) / project.capitalRequiredGBP) / 10
      : 0;
  const latestVersion = Math.max(0, ...agreements.map((a) => a.version));
  const awaitingSignature = agreements.filter((a) => a.status === "SENT").length;

  const tabs: DetailTab[] = [
    { key: "overview", label: "Overview", attention: shortfall && closable },
    { key: "pledges", label: "Pledges", count: livePledges.length },
    { key: "solicitor", label: "Solicitor", attention: !current },
    { key: "agreements", label: "Agreements", count: agreements.length },
  ];
  if (works || sellable || ledger) tabs.push({ key: "sale", label: "Works & sale" });
  tabs.push({
    key: "decisions",
    label: "Decisions",
    count: decisions.length,
    attention: shortfall && closable,
  });
  const tab = pickTab(query.tab, tabs);

  return (
    <div className="max-w-6xl">
      <h1 className="sr-only">Investor project</h1>
      <DetailHeader
        back={{ href: "/admin/projects", label: "All projects" }}
        eyebrow="Investor project"
        title={project.title}
        badges={
          <>
            <Badge tone={closable ? "success" : "default"} data-testid="project-status">
              {statusLabel(project.status)}
            </Badge>
            {project.lead ? (
              <Badge tone="intel">Lead: {project.lead.name ?? "confirmed"}</Badge>
            ) : (
              <Badge tone="warning">No Lead yet</Badge>
            )}
            {current ? null : <Badge tone="warning">No Solicitor</Badge>}
            {shortfall && closable ? (
              <Badge tone="danger">Deadline passed, not funded</Badge>
            ) : null}
          </>
        }
        subtitle={
          <>
            Agent {project.agent.name ?? "—"} · source listing &ldquo;
            {project.listing.title}&rdquo; · published {day(project.publishedAt)}
          </>
        }
      />

      <KeyFacts
        items={[
          { label: "Capital required", value: formatPence(project.capitalRequiredGBP) },
          {
            label: "Pledged so far",
            value: `${percent}%`,
            hint: `${formatPence(pledged)} · ${livePledges.length} pledge${livePledges.length === 1 ? "" : "s"}`,
          },
          { label: "Minimum pledge", value: formatPence(project.minimumPledgeGBP) },
          { label: "Funding deadline", value: day(project.fundingDeadline) },
          {
            label: "Agreements",
            value: agreements.length,
            hint: awaitingSignature
              ? `${awaitingSignature} awaiting signatures`
              : undefined,
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Project sections" />

      {tab === "overview" && (
        <TabBody>
          <DetailColumns
            main={
              <Panel title="Project terms">
                <ProjectSummary project={project} showExpected />
              </Panel>
            }
            side={
              <>
                {shortfall && closable && (
                  <Panel
                    title="Funding shortfall"
                    tone="attention"
                    description="The funding deadline has passed without full funding. Record a decision."
                  >
                    <Link
                      href={`${path}?tab=decisions`}
                      scroll={false}
                      className="text-sm font-semibold text-accent underline"
                    >
                      Go to Decisions →
                    </Link>
                  </Panel>
                )}
                <Panel title="Lead Investor">
                  <p className="text-sm text-body">
                    {project.lead
                      ? `${project.lead.name ?? "Lead Investor"} (confirmed ${day(project.leadConfirmedAt)})`
                      : "Not confirmed yet."}
                  </p>
                  {project.nominations.length > 0 && (
                    <ul className="mt-3 divide-y divide-line text-sm">
                      {project.nominations.map((nomination) => (
                        <li key={nomination.id} className="py-2">
                          <span className="text-body">
                            {nomination.investor.name ?? "Investor"}
                          </span>{" "}
                          <Badge>{nomination.status}</Badge>
                          <span className="mt-0.5 block text-xs text-muted">
                            {day(nomination.nominatedAt)}
                            {nomination.reason ? ` · ${nomination.reason}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title="People">
                  <FactList
                    columns={2}
                    items={[
                      { label: "Agent", value: project.agent.name ?? "—" },
                      {
                        label: "Solicitor",
                        value: current ? `${current.name} (${current.firm})` : "None",
                      },
                    ]}
                  />
                </Panel>
              </>
            }
          />
        </TabBody>
      )}

      {tab === "pledges" && (
        <TabBody>
          <Panel
            title="Pledges"
            description="Expressions of interest until the investor signs the agreement. No money moves through PropLink."
          >
            <PledgeTable pledges={pledges} />
          </Panel>
        </TabBody>
      )}

      {tab === "solicitor" && (
        <TabBody>
          <Panel
            title="Project Solicitor"
            tone={current ? "default" : "attention"}
            description="One Solicitor account per project, created once the Solicitor is agreed. The invitation expires after 7 days; MFA is required. Close the account when the project completes."
          >
            {solicitors.length === 0 ? (
              <p className="text-sm text-muted">No Solicitor invited yet.</p>
            ) : null}
            <ul className="space-y-2 text-sm" data-testid="project-solicitors">
              {solicitors.map((row) => (
                <li key={row.id} className="rounded-lg border border-line bg-white p-3">
                  <p className="text-body">
                    {row.name} ({row.firm}) · {row.email} ·{" "}
                    {row.expired ? "INVITATION EXPIRED" : row.status}
                    {row.acceptedAt ? ` · accepted ${day(row.acceptedAt)}` : ""}
                    {row.endedReason ? ` · ${row.endedReason}` : ""}
                  </p>
                  {(row.status === "INVITED" || row.status === "ACTIVE") && (
                    <div className="mt-2 flex flex-wrap gap-4">
                      {row.status === "INVITED" && (
                        <ActionButton
                          action={solicitorAction}
                          hidden={{
                            intent: "resend",
                            solicitorId: row.id,
                            projectId: project.id,
                          }}
                          label="Re-send invitation"
                          tone="secondary"
                        />
                      )}
                      <ActionButton
                        action={solicitorAction}
                        hidden={{
                          intent: "end",
                          solicitorId: row.id,
                          projectId: project.id,
                        }}
                        label={
                          row.status === "INVITED" ? "Revoke invitation" : "Close account"
                        }
                        tone="danger"
                      >
                        <input
                          name="reason"
                          required
                          placeholder="Reason (e.g. project completed)"
                          className={`w-64 ${INPUT}`}
                        />
                      </ActionButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {!current && (
              <div className="mt-4 max-w-xl">
                <ActionButton
                  action={solicitorAction}
                  hidden={{ intent: "invite", projectId: project.id }}
                  label="Invite the Solicitor"
                >
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      name="name"
                      required
                      placeholder="Solicitor's name"
                      className={INPUT}
                    />
                    <input name="firm" required placeholder="Firm" className={INPUT} />
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="Email (new to PropLink)"
                      className={INPUT}
                    />
                  </div>
                </ActionButton>
              </div>
            )}
          </Panel>
        </TabBody>
      )}

      {tab === "agreements" && (
        <TabBody>
          <Panel
            title="Agreements"
            description="Re-send signing links, void an agreement, or re-issue a fresh one."
          >
            <AgreementList
              agreements={agreements}
              renderActions={(agreement) =>
                agreement.status === "SENT" ? (
                  <div className="flex flex-wrap gap-3">
                    {agreement.parties
                      .filter((party) => party.signerStatus === "PENDING")
                      .map((party) => (
                        <ActionButton
                          key={party.profileId}
                          action={adminAgreementAction}
                          hidden={{
                            intent: "resend",
                            agreementId: agreement.id,
                            profileId: party.profileId,
                            path,
                          }}
                          label={`Re-send link to ${party.name}`}
                          tone="secondary"
                        />
                      ))}
                    <ActionButton
                      action={voidAgreementAction}
                      hidden={{ agreementId: agreement.id, path }}
                      label="Void"
                      tone="danger"
                    >
                      <input
                        name="reason"
                        required
                        placeholder="Reason"
                        className={`w-56 ${INPUT}`}
                      />
                    </ActionButton>
                  </div>
                ) : ["EXPIRED", "DECLINED", "VOIDED"].includes(agreement.status) &&
                  agreement.version === latestVersion ? (
                  <ActionButton
                    action={adminAgreementAction}
                    hidden={{ intent: "reissue", agreementId: agreement.id, path }}
                    label="Re-issue and send fresh"
                  />
                ) : null
              }
            />
          </Panel>
        </TabBody>
      )}

      {tab === "sale" && (
        <TabBody>
          {works && (
            <Panel title="Works, costs and funds">
              <WorksPanel
                view={works}
                projectId={project.id}
                projectStatus={project.status}
                path={path}
              />
            </Panel>
          )}
          {sellable && (
            <Panel
              title="Retail sale"
              description="Normally the project's Agent lists it. Listing here acts on their behalf (their agency, audited) and still goes to listing review."
            >
              <RelistPanel projectId={project.id} path={path} listing={retail} />
            </Panel>
          )}
          {ledger && (
            <Panel title="Sale, ledger and corrections">
              <LedgerPanel
                view={ledger}
                plan={plan}
                projectId={project.id}
                projectStatus={project.status}
                path={path}
                parties={statementParties}
              />
            </Panel>
          )}
        </TabBody>
      )}

      {tab === "decisions" && (
        <TabBody>
          <Panel
            title="Project decisions"
            tone={shortfall && closable ? "attention" : "default"}
            description="Extend, close or change a project. Every decision is recorded."
          >
            <DecisionPanel
              projectId={project.id}
              path={path}
              shortfall={shortfall}
              canDecide={closable}
              decisions={decisions}
            />
          </Panel>
        </TabBody>
      )}
    </div>
  );
}
