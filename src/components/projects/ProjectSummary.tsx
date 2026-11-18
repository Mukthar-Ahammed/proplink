import { day } from "@/components/projects/format";
import { InvestorProjectStatus } from "@/generated/prisma/enums";
import {
  formatPence,
  LIFECYCLE,
  PROJECT_RESPONSIBILITY_NOTICE,
  statusLabel,
} from "@/services/projects/common";

type SummaryProject = {
  status: InvestorProjectStatus;
  mode: string;
  summary: string;
  capitalRequiredGBP: bigint;
  minimumPledgeGBP: bigint;
  fundingDeadline: Date;
  purchaseGBP: bigint;
  marketValueGBP: bigint;
  expectedProfitGBP: bigint | null;
  expectedMonths: number | null;
  closedReason?: string | null;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

/** The lifecycle bar (TRD AG-5), with the current stage highlighted. */
export function Lifecycle({ status }: { status: InvestorProjectStatus }) {
  if (status === InvestorProjectStatus.CLOSED) {
    return <p className="text-sm font-semibold text-warning">Closed</p>;
  }
  const current = LIFECYCLE.findIndex((stage) => stage.key === status);
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Project lifecycle">
      {LIFECYCLE.map((stage, index) => (
        <li
          key={stage.key}
          aria-current={index === current ? "step" : undefined}
          className={`rounded-full px-2.5 py-1 ${
            index === current
              ? "bg-primary text-white"
              : index < current
                ? "bg-pale text-primary"
                : "border border-line text-muted"
          }`}
        >
          {stage.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * Project terms for any viewer. Expected profit and time appear only when
 * `showExpected` (Agent/Admin, or investors once FINANCIAL_PROMOTIONS_REVIEWED).
 */
export function ProjectSummary({
  project,
  showExpected,
}: {
  project: SummaryProject;
  showExpected: boolean;
}) {
  return (
    <div className="space-y-4">
      <Lifecycle status={project.status} />
      <p className="text-sm font-semibold text-primary" data-testid="project-status">
        {statusLabel(project.status)}
        {project.closedReason ? `: ${project.closedReason}` : ""}
      </p>
      <p className="text-sm whitespace-pre-line text-body">{project.summary}</p>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Row
          label="Type"
          value={
            project.mode === "DEVELOPMENT_JV"
              ? "Development joint venture"
              : "Refurbishment / build"
          }
        />
        <Row
          label="Total capital required"
          value={formatPence(project.capitalRequiredGBP)}
        />
        <Row label="Minimum pledge" value={formatPence(project.minimumPledgeGBP)} />
        <Row label="Funding deadline" value={day(project.fundingDeadline)} />
        <Row label="Purchase amount" value={formatPence(project.purchaseGBP)} />
        <Row label="Market value" value={formatPence(project.marketValueGBP)} />
        {showExpected && (
          <>
            <Row
              label="Expected profit (estimate)"
              value={
                project.expectedProfitGBP === null
                  ? null
                  : formatPence(project.expectedProfitGBP)
              }
            />
            <Row
              label="Expected time"
              value={project.expectedMonths ? `${project.expectedMonths} months` : null}
            />
          </>
        )}
      </dl>
      <p className="rounded-lg border border-line bg-surface p-3 text-xs text-muted">
        {PROJECT_RESPONSIBILITY_NOTICE}
      </p>
    </div>
  );
}
