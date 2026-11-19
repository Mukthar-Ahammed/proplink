import { cookies } from "next/headers";
import { requirePageRole } from "@/lib/authz";
import {
  ACTIVE_AGENT_PROFILE_COOKIE,
  resolveActiveAgentProfileId,
} from "@/lib/activeAgentProfile";
import { listActiveAgentProfiles } from "@/services/listings/listingService";
import { getAgentProfileAnalytics } from "@/services/listings/analytics";
import { listEnquiriesForAgentProfile } from "@/services/enquiries/enquiryService";
import { cn } from "@/lib/cn";
import {
  InvestorEmpty,
  InvestorSectionTitle,
  PrimaryLink,
} from "@/components/investor/InvestorUi";
import { LeadsTable, type LeadRow } from "@/components/agents/LeadsTable";

export const metadata = { title: "Agent — Leads" };

/**
 * Agent leads & analytics (Task 2.6). Scoped to the nav's **active** agency
 * profile rather than every profile the user owns — an agent working as one
 * agency shouldn't see another's leads mixed in, and the analytics strip would
 * be meaningless summed across agencies. `listEnquiriesForAgentProfile`
 * re-verifies ownership server-side; the cookie is only ever a hint.
 */
export default async function AgentLeadsPage() {
  const session = await requirePageRole("AGENT");

  const profiles = await listActiveAgentProfiles(session.user.id);
  const activeId = resolveActiveAgentProfileId(
    profiles,
    (await cookies()).get(ACTIVE_AGENT_PROFILE_COOKIE)?.value,
  );

  if (!activeId) {
    return (
      <InvestorEmpty
        title="No agency profile yet"
        action={<PrimaryLink href="/agent/profile">Set up agency profile</PrimaryLink>}
      >
        Leads arrive per agency profile. Set yours up first; it takes a minute.
      </InvestorEmpty>
    );
  }

  const [analytics, enquiries] = await Promise.all([
    getAgentProfileAnalytics(activeId),
    listEnquiriesForAgentProfile({
      agentProfileId: activeId,
      agentUserId: session.user.id,
    }),
  ]);

  const leads: LeadRow[] = enquiries.map((e) => ({
    id: e.id,
    message: e.message,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
    fromName: e.from.name,
    fromEmail: e.from.email,
    propertyId: e.property.id,
    propertyTitle: e.property.title,
  }));

  const stats = [
    { key: "listings", label: "Listings", value: analytics.listings },
    { key: "views", label: "Listing views", value: analytics.views },
    { key: "saves", label: "Saves", value: analytics.saves },
    { key: "leads", label: "Enquiries", value: analytics.leads },
    { key: "new-leads", label: "New (unactioned)", value: analytics.newLeads },
  ];

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Agency"
          tail="analytics"
          description="Figures for the agency profile selected in the navigation."
        />
        {/* Hairlines come from the 1px gaps showing the `line` background. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line shadow-sm sm:grid-cols-5">
          {stats.map((s, index) => (
            <div
              key={s.key}
              className={cn(
                "bg-white p-5 sm:p-6",
                index === stats.length - 1 && "col-span-2 sm:col-span-1",
              )}
            >
              <dt className="text-sm font-medium text-muted">{s.label}</dt>
              <dd
                className="font-display mt-2 text-3xl font-semibold tracking-[-0.02em] text-primary tabular-nums"
                data-testid={`analytics-${s.key}`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle
          title="Buyer"
          tail="enquiries"
          description="Mark each lead as you work it; the status saves straight away."
        />
        <LeadsTable leads={leads} />
      </section>
    </div>
  );
}
