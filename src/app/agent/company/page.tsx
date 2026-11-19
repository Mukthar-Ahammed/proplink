import { requirePageRole } from "@/lib/authz";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  IconChip,
  InvestorSectionTitle,
  SearchIcon,
  StatusPill,
} from "@/components/investor/InvestorUi";
import {
  getOwnCompanyCheck,
  type EffectiveCompanyStatus,
} from "@/services/agents/companyCheck";

import { CompanyLookup } from "./CompanyLookup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Company check" };

type Tone = "neutral" | "success" | "warning" | "danger";

const STATUS_COPY: Record<
  EffectiveCompanyStatus,
  { label: string; tone: Tone; body: string }
> = {
  NOT_SUBMITTED: {
    label: "Not checked yet",
    tone: "neutral",
    body: "Find your company on the Companies House register so buyers, landlords and investors know your agency is real. You need this before you can submit listings for review.",
  },
  VERIFIED: {
    label: "Verified",
    tone: "success",
    body: "Your company is active on the Companies House register.",
  },
  NEEDS_REVIEW: {
    label: "Waiting for PropLink review",
    tone: "warning",
    body: "Your company is on the register but not listed as active. PropLink will review it. If you chose the wrong company, search again below.",
  },
  APPROVED_BY_ADMIN: {
    label: "Approved by PropLink",
    tone: "success",
    body: "PropLink reviewed your company and approved it.",
  },
  REJECTED_BY_ADMIN: {
    label: "Not approved",
    tone: "danger",
    body: "PropLink could not approve this company. Check you chose the right one, or contact PropLink.",
  },
};

function StatusIcon({ tone }: { tone: Tone }) {
  if (tone === "success") return <CheckIcon />;
  if (tone === "warning") return <ClockIcon />;
  if (tone === "danger") return <AlertIcon />;
  return <SearchIcon />;
}

/**
 * Companies House check (Phase 1 Task 4, ADR-024). The Agent's own record is
 * read by their server-verified profile ID; nothing here takes an ID from the
 * client.
 */
export default async function AgentCompanyPage() {
  const session = await requirePageRole("AGENT");
  const { check, status } = await getOwnCompanyCheck(session.user.authUserId);
  const copy = STATUS_COPY[status];

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <InvestorSectionTitle title="Company" tail="check" />
        <div
          className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7"
          data-testid="company-check-status"
        >
          <div className="flex items-start gap-3">
            <IconChip tone={copy.tone === "neutral" ? "accent" : copy.tone}>
              <StatusIcon tone={copy.tone} />
            </IconChip>
            <div className="min-w-0">
              <StatusPill tone={copy.tone}>{copy.label}</StatusPill>
              <p className="mt-2 text-sm leading-relaxed text-muted">{copy.body}</p>
            </div>
          </div>
          {check && (
            <dl className="mt-6 grid gap-4 border-t border-line pt-5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                  Company
                </dt>
                <dd className="mt-1 font-semibold break-words text-primary">
                  {check.companyName}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                  Number
                </dt>
                <dd className="mt-1 text-body tabular-nums">{check.companyNumber}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                  Checked (UTC)
                </dt>
                <dd className="mt-1 text-body tabular-nums">
                  {check.checkedAt.toISOString().slice(0, 16).replace("T", " ")}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle title={check ? "Change" : "Find your"} tail="company" />
        <div className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7">
          <CompanyLookup />
        </div>
      </section>
    </div>
  );
}
