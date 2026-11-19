import Form from "next/form";
import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { requireAdminPagePermission } from "@/lib/authz";
import { listAgents } from "@/services/admin/agents";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { DataTable } from "@/components/ui/data-table";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Admin — Agents | PropLink" };

function pageHref(params: { q?: string; active?: string }, page: number) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.active) query.set("active", params.active);
  query.set("page", String(page));
  return `/admin/agents?${query.toString()}`;
}

export default async function AdminAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; active?: string; page?: string }>;
}) {
  await requireAdminPagePermission("SUSPENSION");
  const params = await searchParams;
  const active =
    params.active === "true" ? true : params.active === "false" ? false : undefined;
  const result = await listAgents({
    q: params.q,
    active,
    page: params.page ? Number(params.page) : 1,
  });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Agents"
        description="Operational visibility over authoritative AgentProfile records. Agency approval workflows are not inferred."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardTitle>Total agents</CardTitle>
          <CardBody className="text-2xl font-semibold text-primary">
            {result.stats.totalAgents}
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Active profiles</CardTitle>
          <CardBody className="text-2xl font-semibold text-primary">
            {result.stats.activeAgents}
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Live listings</CardTitle>
          <CardBody className="text-2xl font-semibold text-primary">
            {result.stats.liveListingsCount}
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Verified deals</CardTitle>
          <CardBody className="text-2xl font-semibold text-primary">
            {result.stats.totalVerifiedDeals}
          </CardBody>
        </Card>
      </div>
      <Form
        action=""
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4"
      >
        <div className="min-w-[240px] flex-1">
          <label
            htmlFor="q"
            className="block text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Name, email, agency or compliance code"
            className="mt-1 w-full rounded-xl border border-line px-4 py-2.5 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="active"
            className="block text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Profile state
          </label>
          <select
            id="active"
            name="active"
            defaultValue={params.active ?? ""}
            className="mt-1 rounded-xl border border-line bg-white px-4 py-2.5 text-sm"
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <SubmitButton
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Search
        </SubmitButton>
        <Link
          href="/admin/agents"
          className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-secondary"
        >
          Clear
        </Link>
      </Form>
      <DataTable
        label="Agents"
        rows={result.agents}
        rowKey={(agent) => agent.id}
        emptyMessage="No AgentProfiles match these filters."
        columns={[
          {
            key: "agent",
            header: "Agent",
            render: (agent) => (
              <div>
                <Link
                  className="font-semibold text-primary hover:underline"
                  href={`/admin/agents/${agent.id}`}
                >
                  {agent.user.name}
                </Link>
                <div className="text-xs text-muted">{agent.user.email}</div>
              </div>
            ),
          },
          {
            key: "agency",
            header: "Agency profile",
            render: (agent) => (
              <div>
                <div>{agent.agencyName}</div>
                <div className="text-xs text-muted">{agent.complianceCode}</div>
              </div>
            ),
          },
          {
            key: "state",
            header: "State",
            render: (agent) => (
              <StatusBadge
                status={agent.active && agent.user.active ? "ACTIVE" : "DEACTIVATED"}
              />
            ),
          },
          {
            key: "listings",
            header: "Listings",
            render: (agent) => (
              <div>
                <div>
                  {agent._count.properties} total · {agent.listingCounts.live} live
                </div>
                <div className="text-xs text-muted">
                  {agent.listingCounts.pending} pending review
                </div>
              </div>
            ),
          },
          {
            key: "joined",
            header: "Joined",
            render: (agent) => (
              <span className="text-xs text-muted">
                {agent.user.createdAt.toISOString().slice(0, 10)}
              </span>
            ),
          },
        ]}
      />
      <div className="flex justify-between text-xs text-muted">
        <span>
          Showing {result.agents.length} of {result.total}
        </span>
        <div className="flex items-center gap-3">
          <span>
            Page {result.page} of {pages}
          </span>
          {result.page > 1 && (
            <Link
              href={pageHref(params, result.page - 1)}
              className="rounded border border-line px-2 py-1 text-secondary hover:border-brand"
            >
              Previous
            </Link>
          )}
          {result.page < pages && (
            <Link
              href={pageHref(params, result.page + 1)}
              className="rounded border border-line px-2 py-1 text-secondary hover:border-brand"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
