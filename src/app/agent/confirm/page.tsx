import { redirect } from "next/navigation";

import { requirePageRole } from "@/lib/authz";
import {
  ClockIcon,
  IconChip,
  InvestorSectionTitle,
  ShieldIcon,
} from "@/components/investor/InvestorUi";
import { getAgentAccessState } from "@/services/agents/agentMigration";
import { listActiveAgentProfiles } from "@/services/listings/listingService";

import { ConfirmForm } from "./ConfirmForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Confirm your account" };

const EYEBROW = "text-xs font-semibold tracking-[0.14em] text-muted uppercase";

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
    <section className="space-y-5">
      <InvestorSectionTitle title="Confirm your" tail="account" />
      {state.kind === "awaiting_authorisation" ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-3xl border border-accent/20 bg-pale/70 p-6 sm:p-7"
          data-testid="migration-state"
        >
          <IconChip>
            <ClockIcon />
          </IconChip>
          <p className="text-sm leading-relaxed text-body">
            You have confirmed your account. PropLink will authorise it shortly. Your
            listings and leads keep working in the meantime.
          </p>
        </div>
      ) : (
        <div
          className="space-y-6 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7"
          data-testid="migration-state"
        >
          <div className="flex items-start gap-3">
            <IconChip>
              <ShieldIcon />
            </IconChip>
            <p className="text-sm leading-relaxed text-muted">
              PropLink now admits agents by invitation. Your account stays active. Please
              confirm the details below so PropLink can authorise your account for new
              features such as landlord chat and investor publishing.
            </p>
          </div>
          <dl className="grid gap-4 rounded-2xl border border-line bg-surface/60 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className={EYEBROW}>Name</dt>
              <dd className="mt-1 font-semibold text-primary">
                {session.user.name ?? "—"}
              </dd>
            </div>
            <div>
              <dt className={EYEBROW}>Email</dt>
              <dd className="mt-1 break-all text-body">{session.user.email}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className={EYEBROW}>Agency profiles</dt>
              <dd className="mt-1 text-body">
                {profiles.length === 0
                  ? "None"
                  : profiles.map((profile) => profile.agencyName).join(", ")}
              </dd>
            </div>
          </dl>
          <div className="border-t border-line pt-6">
            <ConfirmForm />
          </div>
        </div>
      )}
    </section>
  );
}
