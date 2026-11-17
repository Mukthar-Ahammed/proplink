import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import {
  listAgentCompanyChecks,
  type EffectiveCompanyStatus,
} from "@/services/agents/companyCheck";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge, type StatusTone } from "@/components/admin/StatusBadge";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

import { OverrideForm } from "./OverrideForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Agent company checks | PropLink" };

const TONE: Record<EffectiveCompanyStatus, StatusTone> = {
  NEEDS_REVIEW: "warning",
  REJECTED_BY_ADMIN: "danger",
  NOT_SUBMITTED: "neutral",
  APPROVED_BY_ADMIN: "success",
  VERIFIED: "success",
};

function formatDate(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "—";
}

/**
 * Companies House results for every Agent (Phase 1 Task 4, ADR-024). Admin can
 * approve or reject a submitted company with a reason; the decision replaces
 * the automatic result and is audited.
 */
export default async function AdminAgentCompaniesPage() {
  await requirePageRole(Role.ADMIN);
  const agents = await listAgentCompanyChecks();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Agent company checks"
        description="Each Agent's company as recorded on the Companies House register. Inactive companies need a decision. Overrides need a reason and are logged."
      />
      <Card>
        <CardTitle>Agents</CardTitle>
        <CardBody>
          {agents.length === 0 ? (
            <p className="text-sm text-muted">No Agent accounts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="py-2 pr-4">Agent</th>
                    <th className="py-2 pr-4">Company</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Admin decision</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr
                      key={agent.profileId}
                      className="border-t border-line align-top"
                      data-testid={`company-check-row-${agent.profileId}`}
                    >
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-primary">{agent.name}</div>
                        {agent.email && (
                          <div className="text-xs break-all text-muted">
                            {agent.email}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {agent.check ? (
                          <div>
                            <div className="break-words">{agent.check.companyName}</div>
                            <div className="text-xs text-muted">
                              {agent.check.companyNumber} · register status “
                              {agent.check.companyStatus}”
                            </div>
                            <div className="text-xs text-muted">
                              Checked {formatDate(agent.check.checkedAt)} UTC via{" "}
                              {agent.check.provider === "mock"
                                ? "mock register"
                                : "Companies House"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">Not submitted</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={agent.status} tone={TONE[agent.status]} />
                        {agent.check?.override && (
                          <p className="mt-2 max-w-xs text-xs break-words text-muted">
                            {agent.check.overrider?.name ?? "Admin"},{" "}
                            {formatDate(agent.check.overriddenAt)} UTC: “
                            {agent.check.overrideReason}”
                          </p>
                        )}
                      </td>
                      <td className="min-w-[220px] py-3">
                        {agent.check ? (
                          <OverrideForm profileId={agent.profileId} />
                        ) : (
                          <span className="text-xs text-muted">
                            Available once the Agent submits a company
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
