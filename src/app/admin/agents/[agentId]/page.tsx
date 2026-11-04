import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/authz";
import { getAgentDetails } from "@/services/admin/agents";
import { Role } from "@/generated/prisma/enums";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Admin — Agent detail | PropLink" };

export default async function AdminAgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  await requirePageRole(Role.ADMIN);
  const { agentId } = await params;
  const details = await getAgentDetails(agentId);
  if (!details) notFound();
  const { agent } = details;
  const active =
    agent.active && agent.user.active && (agent.user.authProfile?.active ?? true);
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={agent.agencyName}
        description="AgentProfile detail and related marketplace context. This page does not impersonate the Agent."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/agents"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Back to agents
        </Link>
        <StatusBadge status={active ? "ACTIVE" : "DEACTIVATED"} />
      </div>
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Agent identity</CardTitle>
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Name</dt>
                <dd className="font-semibold">{agent.user.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Email</dt>
                <dd>{agent.user.email}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Compliance code
                </dt>
                <dd>{agent.complianceCode}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Joined</dt>
                <dd>{agent.user.createdAt.toISOString().slice(0, 10)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Profile rating
                </dt>
                <dd>{agent.rating.toFixed(1)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Verified deals
                </dt>
                <dd>{agent.verifiedDealCount}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Subscription</CardTitle>
          <CardBody>
            {details.subscription ? (
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt>Tier</dt>
                  <dd>{details.subscription.tier}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Status</dt>
                  <dd>{details.subscription.status}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Listing limit</dt>
                  <dd>{details.subscription.listingLimit}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted">No subscription record.</p>
            )}
          </CardBody>
        </Card>
      </section>
      <Card>
        <CardTitle>Marketplace records</CardTitle>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted">
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
              <p className="py-4 text-muted">No listings found.</p>
            )}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Agency model</CardTitle>
        <CardBody>
          <p>
            This repository has an AgentProfile-level <code>agencyName</code> string, not
            a separate Agency entity, owner relationship, approval state, or agency-level
            listing cap. A separate Agency management route was therefore not created.
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Recent governance events</CardTitle>
        <CardBody>
          {details.auditLogs.length ? (
            <div className="divide-y divide-line">
              {details.auditLogs.map((event) => (
                <div key={event.id} className="py-2 text-sm">
                  <span className="font-semibold">{event.action}</span>
                  <span className="ml-2 text-muted">{event.createdAt.toISOString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">No related audit events.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
