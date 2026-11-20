import { cookies } from "next/headers";
import { requirePageRole } from "@/lib/authz";
import { listActiveAgentProfiles } from "@/services/listings/listingService";
import { ActiveProfileSwitcher } from "@/components/agents/ActiveProfileSwitcher";
import { PortalShell } from "@/components/portal/PortalShell";
import { AGENT_FRAME } from "@/components/portal/portalFrames";
import { AGENT_NAV } from "@/app/agent/nav";
import {
  SubscriptionGate,
  needsSubscriptionPopup,
} from "@/components/billing/SubscriptionGate";
import {
  ACTIVE_AGENT_PROFILE_COOKIE,
  resolveActiveAgentProfileId,
} from "@/lib/activeAgentProfile";

/**
 * The agent portal's frame (ADR-016; banner masthead per ADR-071, like the
 * buyer, investor and landlord portals). Role gating is `src/middleware.ts`
 * (AGENT/ADMIN) plus per-action `requireRole`.
 *
 * It carries the portal's single `<h1>` and its sub-nav, so every page below
 * contributes `<h2>`s only. The profile switcher rides on the masthead as
 * `aside` — an agent can hold several agency profiles and needs to see which one
 * the page is showing without leaving it.
 *
 * Messages is a subscription feature: its tab wears a gold crown, and while
 * the agent has no active subscription the tab opens the subscription popup
 * (rendered here once, button-less) instead of navigating. /messages and every
 * chat action still enforce the subscription server-side.
 */
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageRole("AGENT");
  const [profiles, locked] = await Promise.all([
    listActiveAgentProfiles(session.user.id),
    needsSubscriptionPopup(),
  ]);
  const cookieStore = await cookies();
  const activeId = resolveActiveAgentProfileId(
    profiles,
    cookieStore.get(ACTIVE_AGENT_PROFILE_COOKIE)?.value,
  );

  return (
    <PortalShell
      {...AGENT_FRAME}
      nav={AGENT_NAV.map((item) =>
        item.href === "/messages" ? { ...item, premium: true, locked } : item,
      )}
      aside={
        profiles.length > 1 && activeId ? (
          <ActiveProfileSwitcher
            profiles={profiles.map((p) => ({ id: p.id, agencyName: p.agencyName }))}
            activeId={activeId}
          />
        ) : profiles.length === 1 ? (
          <span className="inline-flex items-center rounded-full border border-line bg-white/80 px-4 py-1.5 text-sm font-medium text-primary backdrop-blur-sm">
            {profiles[0].agencyName}
          </span>
        ) : null
      }
    >
      {children}
      {locked && <SubscriptionGate hideTrigger openOnEvent returnPath="/messages" />}
    </PortalShell>
  );
}
