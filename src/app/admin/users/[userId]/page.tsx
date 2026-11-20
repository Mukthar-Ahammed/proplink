import { isRecentlyAuthenticated, REAUTH_MESSAGE } from "@/services/auth/mfa";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminPagePermission, requireAdminPermission } from "@/lib/authz";
import { getUserDetails, setUserActive } from "@/services/admin/users";
import { Role } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { KycPill } from "@/components/layout/KycPill";
import { AccountStateAction } from "@/components/admin/AccountStateAction";
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

export const metadata = { title: "Admin — User detail | PropLink" };

async function changeAccountState(formData: FormData) {
  "use server";
  const authz = await requireAdminPermission("SUSPENSION");
  if (!authz.ok) return;
  // Phase 1 Task 11 (ADR-030): destructive Admin actions need a recent check.
  if (!isRecentlyAuthenticated(authz.session.user)) {
    throw new Error(`${REAUTH_MESSAGE} Go to /mfa?reauth=1`);
  }
  const result = await setUserActive({
    actor: {
      profileId: authz.session.user.authUserId,
      legacyUserId: authz.session.user.id,
    },
    userId: String(formData.get("userId")),
    active: formData.get("nextActive") === "true",
    reason: String(formData.get("reason") ?? ""),
  });
  if (!result.ok) throw new Error(result.error);
  revalidatePath(`/admin/users/${String(formData.get("userId"))}`);
  revalidatePath("/admin/users");
}

/** One account for Admin, in tabs (ADR-080): Account · Agent profiles · KYC · Audit. */
export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await requireAdminPagePermission("SUSPENSION");
  const [{ userId }, query] = await Promise.all([params, searchParams]);
  const details = await getUserDetails(userId);
  if (!details) notFound();
  const { user, activityMetrics } = details;
  const profile = user.authProfile;
  const path = `/admin/users/${user.id}`;
  const kycPending = user.kycSubmissions.some(
    (submission) => submission.status === "SUBMITTED",
  );

  const tabs: DetailTab[] = [{ key: "account", label: "Account" }];
  if (user.agentProfiles.length > 0) {
    tabs.push({
      key: "agent",
      label: "Agent profiles",
      count: user.agentProfiles.length,
    });
  }
  if (user.kycSubmissions.length > 0) {
    tabs.push({
      key: "kyc",
      label: "Identity checks",
      count: user.kycSubmissions.length,
      attention: kycPending,
    });
  }
  tabs.push({ key: "audit", label: "Audit history", count: details.auditLogs.length });
  const tab = pickTab(query.tab, tabs);

  return (
    <div>
      <h1 className="sr-only">User detail</h1>
      <DetailHeader
        back={{ href: "/admin/users", label: "Back to users" }}
        eyebrow="Account"
        title={user.name}
        badges={
          <>
            <StatusBadge status={user.active ? "ACTIVE" : "DEACTIVATED"} />
            <Badge tone={user.role === Role.ADMIN ? "intel" : "default"}>
              {user.role}
            </Badge>
            <KycPill status={profile?.kycStatus ?? user.kycStatus} />
          </>
        }
        subtitle="Purpose-limited account governance and operational context."
        actions={
          <AccountStateAction
            userId={user.id}
            active={user.active}
            action={changeAccountState}
          />
        }
      />

      <KeyFacts
        items={[
          { label: "Listings", value: activityMetrics.propertyCount },
          { label: "Buyer offers", value: activityMetrics.offerCount },
          { label: "Flipper resales", value: activityMetrics.resaleCount },
          { label: "Syndicate pledges", value: activityMetrics.pledgeCount },
          { label: "Joined", value: user.createdAt.toISOString().slice(0, 10) },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Account sections" />

      {tab === "account" && (
        <TabBody>
          <DetailColumns
            main={
              <Panel title="Account">
                <FactList
                  items={[
                    { label: "Name", value: user.name },
                    { label: "Email", value: user.email },
                    { label: "Primary role", value: user.role },
                    { label: "Joined", value: user.createdAt.toISOString().slice(0, 10) },
                    {
                      label: "KYC authorization",
                      value: <KycPill status={profile?.kycStatus ?? user.kycStatus} />,
                    },
                    {
                      label: "Investor subtype",
                      value: profile?.investorType ?? "Not applicable / not assigned",
                    },
                  ]}
                />
              </Panel>
            }
            side={
              <Panel
                title="Account state"
                tone={user.active ? "default" : "attention"}
                description={
                  user.active
                    ? "Active. Suspending (button above) needs a reason and a recent sign-in check, and is audited."
                    : "Suspended: this person cannot sign in. Reactivate with the button above."
                }
              />
            }
          />
        </TabBody>
      )}

      {tab === "agent" && (
        <TabBody>
          <Panel title="Agent profiles" description="Open a profile to manage it.">
            <div className="grid gap-3 md:grid-cols-2">
              {user.agentProfiles.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/admin/agents/${agent.id}`}
                  className="rounded-xl border border-line p-4 hover:border-accent"
                >
                  <div className="font-semibold text-primary">{agent.agencyName}</div>
                  <div className="mt-1 text-sm text-muted">
                    {agent.complianceCode} · {agent._count.properties} listings ·{" "}
                    {agent.active ? "Profile active" : "Profile inactive"}
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        </TabBody>
      )}

      {tab === "kyc" && (
        <TabBody>
          <Panel title="Identity checks" tone={kycPending ? "attention" : "default"}>
            <div className="divide-y divide-line">
              {user.kycSubmissions.map((submission) => (
                <div
                  key={submission.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <StatusBadge status={submission.status} />
                    <span className="ml-3 text-xs text-muted">
                      {submission.createdAt.toISOString().slice(0, 10)} ·{" "}
                      {submission.documents.length} document(s)
                    </span>
                  </div>
                  <Link
                    href={`/admin/kyc/${submission.id}`}
                    className="text-sm font-semibold text-accent hover:underline"
                  >
                    Open KYC review
                  </Link>
                </div>
              ))}
            </div>
          </Panel>
        </TabBody>
      )}

      {tab === "audit" && (
        <TabBody>
          <Panel title="Recent audit history">
            {details.auditLogs.length === 0 ? (
              <p className="text-sm text-muted">No related audit events.</p>
            ) : (
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
            )}
          </Panel>
        </TabBody>
      )}
    </div>
  );
}
