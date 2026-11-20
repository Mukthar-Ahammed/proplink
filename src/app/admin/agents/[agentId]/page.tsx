import { notFound } from "next/navigation";
import { requireAdminPagePermission } from "@/lib/authz";
import { getAgentDetails } from "@/services/admin/agents";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  DetailColumns,
  DetailHeader,
  DetailTabs,
  FactList,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Admin — Agent detail | PropLink" };

/** One Agent profile for Admin, in tabs (ADR-080): Profile · Listings · History. */
export default async function AdminAgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await requireAdminPagePermission("SUSPENSION");
  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  const details = await getAgentDetails(agentId);
  if (!details) notFound();
  const { agent } = details;
  const active =
    agent.active && agent.user.active && (agent.user.authProfile?.active ?? true);
  const path = `/admin/agents/${agent.id}`;
  const subscription = details.subscription;

  const tabs: DetailTab[] = [
    { key: "profile", label: "Profile" },
    { key: "listings", label: "Listings", count: agent.properties.length },
    { key: "history", label: "Governance history", count: details.auditLogs.length },
  ];
  const tab = pickTab(query.tab, tabs);

  return (
    <div>
      <h1 className="sr-only">Agent detail</h1>
      <DetailHeader
        back={{ href: "/admin/agents", label: "Back to agents" }}
        eyebrow="Agent profile"
        title={agent.agencyName}
        badges={
          <>
            <StatusBadge status={active ? "ACTIVE" : "DEACTIVATED"} />
            {subscription ? (
              <Badge tone="intel">
                {subscription.tier} · {subscription.status}
              </Badge>
            ) : (
              <Badge tone="warning">No subscription</Badge>
            )}
          </>
        }
        subtitle="AgentProfile detail and related marketplace context. This page does not impersonate the Agent."
      />

      <KeyFacts
        items={[
          { label: "Listings", value: agent.properties.length },
          { label: "Verified deals", value: agent.verifiedDealCount },
          { label: "Profile rating", value: agent.rating.toFixed(1) },
          {
            label: "Listing limit",
            value: subscription ? subscription.listingLimit : "—",
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Agent sections" />

      {tab === "profile" && (
        <TabBody>
          <DetailColumns
            main={
              <Panel title="Agent identity">
                <FactList
                  items={[
                    { label: "Name", value: agent.user.name },
                    { label: "Email", value: agent.user.email },
                    { label: "Compliance code", value: agent.complianceCode },
                    {
                      label: "Joined",
                      value: agent.user.createdAt.toISOString().slice(0, 10),
                    },
                    { label: "Profile rating", value: agent.rating.toFixed(1) },
                    { label: "Verified deals", value: agent.verifiedDealCount },
                  ]}
                />
              </Panel>
            }
            side={
              <>
                <Panel title="Subscription">
                  {subscription ? (
                    <FactList
                      items={[
                        { label: "Tier", value: subscription.tier },
                        { label: "Status", value: subscription.status },
                        {
                          label: "Listing limit",
                          value: subscription.listingLimit,
                          wide: true,
                        },
                      ]}
                    />
                  ) : (
                    <p className="text-sm text-muted">No subscription record.</p>
                  )}
                </Panel>
                <Panel title="Agency model" tone="muted">
                  <p className="text-sm text-muted">
                    This repository has an AgentProfile-level <code>agencyName</code>{" "}
                    string, not a separate Agency entity, owner relationship, approval
                    state, or agency-level listing cap. A separate Agency management route
                    was therefore not created.
                  </p>
                </Panel>
              </>
            }
          />
        </TabBody>
      )}

      {tab === "listings" && (
        <TabBody>
          <Panel
            title="Marketplace records"
            description="Every listing this Agent created."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted uppercase">
                  <tr>
                    <th className="py-2">Property</th>
                    <th>Status</th>
                    <th>Location</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {agent.properties.map((property) => (
                    <tr key={property.id}>
                      <td className="py-3 font-semibold">{property.title}</td>
                      <td>
                        <StatusBadge status={property.status} />
                      </td>
                      <td>
                        {property.city} {property.postcode}
                      </td>
                      <td>{property.createdAt.toISOString().slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {agent.properties.length === 0 && (
                <p className="py-4 text-sm text-muted">No listings found.</p>
              )}
            </div>
          </Panel>
        </TabBody>
      )}

      {tab === "history" && (
        <TabBody>
          <Panel title="Recent governance events">
            {details.auditLogs.length ? (
              <div className="divide-y divide-line">
                {details.auditLogs.map((event) => (
                  <div key={event.id} className="py-2 text-sm">
                    <span className="font-semibold">{event.action}</span>
                    <span className="ml-2 text-muted">
                      {event.createdAt.toISOString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No related audit events.</p>
            )}
          </Panel>
        </TabBody>
      )}
    </div>
  );
}
