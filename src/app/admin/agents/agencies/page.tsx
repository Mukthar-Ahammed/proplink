import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActionButton } from "@/components/projects/ActionButton";
import { Card, CardBody } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { listAgencies } from "@/services/admin/agencies";

import { agencyActiveAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Agencies | PropLink",
  robots: { index: false },
};

const field = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";

/**
 * Agencies (Phase 6 Task 5, ADR-062): Agents grouped by the company their
 * Companies House check verified. Suspending an agency suspends every Agent
 * profile in it.
 */
export default async function AdminAgenciesPage() {
  await requireAdminPagePermission("SUSPENSION");
  const agencies = await listAgencies();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Agencies"
        description="Agents grouped by the company their Companies House check found. Suspending an agency hides all its listings and blocks its Agents' agency profiles until reactivated; it is logged with your reason."
      />
      {agencies.length === 0 ? (
        <p className="text-sm text-muted">No Agents yet.</p>
      ) : (
        <ul className="space-y-4" data-testid="agencies">
          {agencies.map((agency) => {
            const profiles = agency.agents.flatMap((a) => a.agencyProfiles);
            const anyActive = profiles.some((p) => p.active);
            const live = profiles.reduce((sum, p) => sum + p.liveListings, 0);
            return (
              <li key={agency.companyNumber ?? "none"}>
                <Card>
                  <CardBody>
                    <p className="font-semibold text-primary">
                      {agency.companyName}{" "}
                      <span className="font-normal text-muted">
                        {agency.companyNumber ? `· ${agency.companyNumber}` : ""}
                        {agency.companyStatus ? ` · ${agency.companyStatus}` : ""} ·{" "}
                        {agency.verified ? "verified" : "not verified"} ·{" "}
                        {agency.agents.length} Agent
                        {agency.agents.length === 1 ? "" : "s"} · {live} live listing
                        {live === 1 ? "" : "s"}
                      </span>
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {agency.agents.map((agent) => (
                        <li key={agent.profileId} className="text-body">
                          {agent.name ?? "Agent"}
                          {!agent.active && " (account inactive)"}:{" "}
                          {agent.agencyProfiles.length === 0
                            ? "no agency profile"
                            : agent.agencyProfiles.map((p, i) => (
                                <span key={p.id}>
                                  {i > 0 && ", "}
                                  <Link
                                    href={`/admin/agents/${p.id}`}
                                    className="text-accent underline"
                                  >
                                    {p.agencyName}
                                  </Link>{" "}
                                  ({p.active ? "active" : "suspended"}, {p.liveListings}{" "}
                                  live)
                                </span>
                              ))}
                        </li>
                      ))}
                    </ul>
                    {agency.companyNumber && profiles.length > 0 && (
                      <div className="mt-3">
                        <ActionButton
                          action={agencyActiveAction}
                          hidden={{
                            companyNumber: agency.companyNumber,
                            active: anyActive ? "false" : "true",
                          }}
                          label={anyActive ? "Suspend agency" : "Reactivate agency"}
                          tone={anyActive ? "danger" : "secondary"}
                        >
                          <input
                            name="reason"
                            required
                            minLength={5}
                            placeholder="Reason"
                            aria-label="Reason"
                            className={field}
                          />
                        </ActionButton>
                      </div>
                    )}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
