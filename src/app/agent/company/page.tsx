import { requirePageRole } from "@/lib/authz";
import { PortalSection } from "@/components/portal/PortalShell";
import {
  getOwnCompanyCheck,
  type EffectiveCompanyStatus,
} from "@/services/agents/companyCheck";

import { CompanyLookup } from "./CompanyLookup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Company check" };

const STATUS_COPY: Record<
  EffectiveCompanyStatus,
  { label: string; tone: string; body: string }
> = {
  NOT_SUBMITTED: {
    label: "Not checked yet",
    tone: "text-muted",
    body: "Find your company on the Companies House register so buyers, landlords and investors know your agency is real.",
  },
  VERIFIED: {
    label: "Verified",
    tone: "text-success",
    body: "Your company is active on the Companies House register.",
  },
  NEEDS_REVIEW: {
    label: "Waiting for PropLink review",
    tone: "text-warning",
    body: "Your company is on the register but not listed as active. PropLink will review it. If you chose the wrong company, search again below.",
  },
  APPROVED_BY_ADMIN: {
    label: "Approved by PropLink",
    tone: "text-success",
    body: "PropLink reviewed your company and approved it.",
  },
  REJECTED_BY_ADMIN: {
    label: "Not approved",
    tone: "text-danger",
    body: "PropLink could not approve this company. Check you chose the right one, or contact PropLink.",
  },
};

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
    <>
      <PortalSection title="Company check">
        <div
          className="rounded-lg border border-line bg-white p-5"
          data-testid="company-check-status"
        >
          <p className={`text-sm font-semibold ${copy.tone}`}>{copy.label}</p>
          <p className="mt-1 text-sm text-muted">{copy.body}</p>
          {check && (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs tracking-wide text-muted uppercase">Company</dt>
                <dd className="font-medium break-words text-primary">
                  {check.companyName}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-muted uppercase">Number</dt>
                <dd>{check.companyNumber}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-muted uppercase">
                  Checked (UTC)
                </dt>
                <dd>{check.checkedAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
              </div>
            </dl>
          )}
        </div>
      </PortalSection>

      <PortalSection title={check ? "Change company" : "Find your company"}>
        <CompanyLookup />
      </PortalSection>
    </>
  );
}
