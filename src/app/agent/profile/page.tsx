import { requirePageRole } from "@/lib/authz";
import { listActiveAgentProfiles } from "@/services/listings/listingService";
import { listCaseStudiesForOwnedProfile } from "@/services/agents/agentProfileService";
import { CaseStudyManager } from "@/components/agents/CaseStudyManager";
import { AgencyProfileForm } from "@/components/agents/AgencyProfileForm";
import { getAgencyProfileSetupState } from "@/services/agents/agencyProfileSetup";
import {
  ArrowLink,
  IconChip,
  InvestorEmpty,
  ShieldIcon,
  StatusPill,
} from "@/components/investor/InvestorUi";

export const metadata = { title: "Agent — Profile" };

/**
 * Agency credibility hub management (Task 2.4): one card per `AgentProfile`
 * the signed-in agent owns, each with a link to its public `/agents/[id]`
 * page and a `CaseStudyManager` for that profile's case studies (capex/net
 * margin/narrative). Star rating, verified deal count and investor
 * appraisals are read-only aggregates shown on the public page, not here.
 */
export default async function AgentPortalProfilePage() {
  const session = await requirePageRole("AGENT");
  const userId = session.user.id;

  const [profiles, setup] = await Promise.all([
    listActiveAgentProfiles(userId),
    getAgencyProfileSetupState({
      legacyUserId: userId,
      profileId: session.user.authUserId,
    }),
  ]);

  // First run (ADR-074): the Agent creates their own agency profile here.
  if (profiles.length === 0) {
    if (!setup.canCreate) {
      return <InvestorEmpty title="No agency profile">{setup.reason}</InvestorEmpty>;
    }
    return (
      <section
        data-testid="agency-profile-setup"
        className="mx-auto max-w-2xl rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="flex items-start gap-3">
          <IconChip>
            <ShieldIcon />
          </IconChip>
          <div>
            <h2 className="font-display text-2xl leading-tight font-semibold tracking-[-0.02em] text-primary">
              Set up your
              <span className="font-serif font-normal tracking-normal italic">
                {" "}
                agency profile
              </span>
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Your listings, leads and public agency page all sit under this profile. You
              can add case studies once it exists.
            </p>
          </div>
        </div>
        <div className="mt-7 border-t border-line pt-6">
          <AgencyProfileForm suggestedName={setup.suggestedName} />
        </div>
      </section>
    );
  }

  const caseStudiesByProfile = await Promise.all(
    profiles.map((p) => listCaseStudiesForOwnedProfile({ userId, agentProfileId: p.id })),
  );

  return (
    <div className="space-y-8">
      {profiles.map((profile, i) => (
        <section
          key={profile.id}
          data-testid={`agent-profile-card-${profile.id}`}
          className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <IconChip>
                <ShieldIcon />
              </IconChip>
              <div className="min-w-0">
                <h2 className="font-display text-2xl leading-tight font-semibold tracking-[-0.02em] break-words text-primary">
                  {profile.agencyName}
                </h2>
                <div className="mt-1.5">
                  <StatusPill>Compliance code: {profile.complianceCode}</StatusPill>
                </div>
              </div>
            </div>
            <ArrowLink href={`/agents/${profile.id}`}>View public profile</ArrowLink>
          </div>

          <div className="mt-7 border-t border-line pt-6">
            <h3 className="font-display text-xl leading-tight font-semibold tracking-[-0.02em] text-primary">
              Case
              <span className="font-serif font-normal tracking-normal italic">
                {" "}
                studies
              </span>
            </h3>
            <div className="mt-5">
              <CaseStudyManager
                agentProfileId={profile.id}
                caseStudies={caseStudiesByProfile[i].map((cs) => ({
                  id: cs.id,
                  title: cs.title,
                  capexGBP: cs.capexGBP,
                  netMarginGBP: cs.netMarginGBP,
                  description: cs.description,
                  imageUrl: cs.imageUrl,
                }))}
              />
            </div>
          </div>
        </section>
      ))}

      {setup.canCreate ? (
        <details className="group rounded-3xl border border-dashed border-line bg-surface/60 p-6 sm:p-7">
          <summary className="cursor-pointer list-none text-sm font-semibold text-primary group-open:mb-5">
            + Add another agency profile
            <span className="mt-1 block text-sm font-normal text-muted">
              For a second brand or trading name you list under.
            </span>
          </summary>
          <AgencyProfileForm suggestedName="" submitLabel="Add agency profile" />
        </details>
      ) : null}
    </div>
  );
}
