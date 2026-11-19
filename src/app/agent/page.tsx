import { AdSlot } from "@/components/ads/AdSlot";
import Link from "next/link";
import { requirePageRole } from "@/lib/authz";
import { getAgentDashboard } from "@/services/agents/agentDashboard";
import { PortalEmpty, PortalSection, StatCard } from "@/components/portal/PortalShell";
import { PortalAnnouncements } from "@/components/portal/Announcements";
import { listActiveAnnouncements } from "@/services/announcements/announcements";
import { getOwnCompanyCheck } from "@/services/agents/companyCheck";
import { getAgentAccessState } from "@/services/agents/agentMigration";

// Middleware-gated, always per-request — never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * The agent portal's front door (ADR-016). It replaced a bare
 * `redirect("/agent/listings")`, which left the portal with no home and no
 * overview.
 *
 * `requireRole` again despite the middleware gate: the middleware reads the JWT
 * at the edge and is a routing concern, while this is the server-side check
 * AGENTS.md requires on anything that reads a user's own data.
 */
export default async function AgentHomePage() {
  // The middleware already gated this route on the JWT at the edge; this is the
  // server-side check AGENTS.md requires before reading a user's own data, and
  // it is what narrows `session.user` for the query below.
  const { user } = await requirePageRole("AGENT");
  const [data, announcements, company, access] = await Promise.all([
    getAgentDashboard(user.id),
    listActiveAnnouncements("AGENT"),
    getOwnCompanyCheck(user.authUserId),
    getAgentAccessState(user.authUserId),
  ]);
  const migrationPrompt =
    access.kind === "needs_confirmation"
      ? "PropLink now admits agents by invitation. Confirm your account so it can be authorised for new features."
      : access.kind === "awaiting_authorisation"
        ? "Your account is confirmed and waiting for PropLink to authorise it."
        : null;
  const companyPrompt =
    company.status === "NOT_SUBMITTED"
      ? "Check your company against the Companies House register before submitting listings."
      : company.status === "NEEDS_REVIEW" || company.status === "REJECTED_BY_ADMIN"
        ? "Your company check needs attention."
        : null;

  return (
    <>
      <PortalAnnouncements items={announcements} />

      {migrationPrompt && (
        <div
          role="status"
          data-testid="migration-prompt"
          className="mb-4 flex flex-col gap-2 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-primary">{migrationPrompt}</p>
          {access.kind === "needs_confirmation" && (
            <Link
              href="/agent/confirm"
              className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
            >
              Confirm account
            </Link>
          )}
        </div>
      )}

      {companyPrompt && (
        <div
          role="status"
          data-testid="company-check-prompt"
          className="mb-8 flex flex-col gap-2 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-primary">{companyPrompt}</p>
          <Link
            href="/agent/company"
            className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
          >
            Company check
          </Link>
        </div>
      )}

      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={data.liveListings} label="Live listings" />
        <StatCard
          value={data.pendingListings}
          label="Awaiting review"
          hint={data.pendingListings > 0 ? "With the moderation queue" : undefined}
        />
        <StatCard value={data.draftListings} label="Drafts" />
        <StatCard
          value={data.newLeads}
          label="New leads"
          hint={data.newLeads > 0 ? "Unactioned enquiries" : undefined}
        />
      </div>

      <PortalSection
        title="Latest leads"
        action={
          <Link
            href="/agent/leads"
            className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
          >
            All leads
          </Link>
        }
      >
        {data.recentLeads.length === 0 ? (
          <PortalEmpty>
            No enquiries yet. Leads appear here the moment a buyer contacts you about a
            live listing.
          </PortalEmpty>
        ) : (
          <ul className="border-t border-line">
            {data.recentLeads.map((lead) => (
              <li
                key={lead.id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4"
              >
                <Link
                  href={`/marketplace/${lead.propertyId}`}
                  className="font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
                >
                  {lead.propertyTitle}
                </Link>
                <span className="text-xs tracking-[0.12em] text-muted uppercase">
                  {lead.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>

      <PortalSection title="Verified record">
        <p className="text-sm leading-relaxed text-muted">
          {data.verifiedDealCount === 0
            ? "No completed deals recorded yet. Deals completed on-platform are added to your public profile automatically."
            : `${data.verifiedDealCount} completed ${data.verifiedDealCount === 1 ? "deal" : "deals"} recorded against your profile.`}
        </p>
      </PortalSection>
      {/* Phase 6 (ADR-060): one designated sponsored slot; nothing renders without a live ad. */}
      <AdSlot slot="AGENT_DASHBOARD" />
    </>
  );
}
