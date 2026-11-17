import { redirect } from "next/navigation";

import { requirePageRole } from "@/lib/authz";
import { PortalSection } from "@/components/portal/PortalShell";
import { getAgentAccessState } from "@/services/agents/agentMigration";
import { listActiveAgentProfiles } from "@/services/listings/listingService";

import { ConfirmForm } from "./ConfirmForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Confirm your account" };

/**
 * Phase 1 Task 5 (ADR-025, Q2): an Agent who registered before invite-only
 * onboarding confirms their account here; Admin then authorises it.
 */
export default async function AgentConfirmPage() {
  const session = await requirePageRole("AGENT");
  const state = await getAgentAccessState(session.user.authUserId);
  if (state.kind === "invited" || state.kind === "authorised") redirect("/agent");

  const profiles = await listActiveAgentProfiles(session.user.id);

  return (
    <PortalSection title="Confirm your account">
      {state.kind === "awaiting_authorisation" ? (
        <p role="status" className="text-sm text-muted" data-testid="migration-state">
          You have confirmed your account. PropLink will authorise it shortly. Your
          listings and leads keep working in the meantime.
        </p>
      ) : (
        <div className="space-y-5" data-testid="migration-state">
          <p className="text-sm leading-relaxed text-muted">
            PropLink now admits agents by invitation. Your account stays active. Please
            confirm the details below so PropLink can authorise your account for new
            features such as landlord chat and investor publishing.
          </p>
          <dl className="grid gap-3 rounded-lg border border-line bg-white p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs tracking-wide text-muted uppercase">Name</dt>
              <dd className="font-medium text-primary">{session.user.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-muted uppercase">Email</dt>
              <dd className="break-all">{session.user.email}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs tracking-wide text-muted uppercase">
                Agency profiles
              </dt>
              <dd>
                {profiles.length === 0
                  ? "None"
                  : profiles.map((profile) => profile.agencyName).join(", ")}
              </dd>
            </div>
          </dl>
          <ConfirmForm />
        </div>
      )}
    </PortalSection>
  );
}
