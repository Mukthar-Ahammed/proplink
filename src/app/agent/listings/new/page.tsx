import { cookies } from "next/headers";
import { requirePageRole } from "@/lib/authz";
import { listActiveAgentProfiles } from "@/services/listings/listingService";
import { ListingWizard } from "@/components/listings/ListingWizard";
import { emptyWizardState } from "@/components/listings/wizardTypes";
import {
  ArrowLink,
  InvestorEmpty,
  InvestorSectionTitle,
  PrimaryLink,
} from "@/components/investor/InvestorUi";
import {
  ACTIVE_AGENT_PROFILE_COOKIE,
  resolveActiveAgentProfileId,
} from "@/lib/activeAgentProfile";

export const metadata = { title: "Agent — New listing" };

export default async function NewListingPage() {
  const session = await requirePageRole("AGENT");
  const profiles = await listActiveAgentProfiles(session.user.id);

  if (profiles.length === 0) {
    return (
      <InvestorEmpty
        title="No agency profile yet"
        action={<PrimaryLink href="/agent/profile">Set up agency profile</PrimaryLink>}
      >
        Listings are published under an agency profile. Set yours up first; it takes a
        minute.
      </InvestorEmpty>
    );
  }

  // Defaults to the agent nav's active-profile selection (Task 2.4); still
  // overridable per-listing via the wizard's own picker (`ListingWizard`,
  // Task 2.2) when the agent owns more than one profile.
  const cookieStore = await cookies();
  const activeId =
    resolveActiveAgentProfileId(
      profiles,
      cookieStore.get(ACTIVE_AGENT_PROFILE_COOKIE)?.value,
    ) ?? profiles[0].id;

  return (
    <section className="space-y-8">
      <InvestorSectionTitle
        title="New"
        tail="listing"
        description="Five short steps. Save a draft at any point; it reaches PropLink review only when you submit it."
        action={<ArrowLink href="/agent/listings">Your listings</ArrowLink>}
      />
      <ListingWizard
        agentProfiles={profiles.map((p) => ({ id: p.id, agencyName: p.agencyName }))}
        initial={emptyWizardState(activeId)}
      />
    </section>
  );
}
