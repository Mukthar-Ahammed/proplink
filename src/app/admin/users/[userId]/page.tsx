import { isRecentlyAuthenticated, REAUTH_MESSAGE } from "@/services/auth/mfa";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePageRole, requireRole } from "@/lib/authz";
import { getUserDetails, setUserActive } from "@/services/admin/users";
import { Role } from "@/generated/prisma/enums";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { KycPill } from "@/components/layout/KycPill";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AccountStateAction } from "@/components/admin/AccountStateAction";

export const metadata = { title: "Admin — User detail | PropLink" };

async function changeAccountState(formData: FormData) {
  "use server";
  const authz = await requireRole(Role.ADMIN);
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

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  await requirePageRole(Role.ADMIN);
  const { userId } = await params;
  const details = await getUserDetails(userId);
  if (!details) notFound();
  const { user, activityMetrics } = details;
  const profile = user.authProfile;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={user.name}
        description="Purpose-limited account governance and operational context."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/users"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Back to users
        </Link>
        <StatusBadge status={user.active ? "ACTIVE" : "DEACTIVATED"} />
        <Badge tone={user.role === Role.ADMIN ? "intel" : "default"}>{user.role}</Badge>
        <AccountStateAction
          userId={user.id}
          active={user.active}
          action={changeAccountState}
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Account</CardTitle>
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Name</dt>
                <dd className="font-semibold text-primary">{user.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Primary role
                </dt>
                <dd>{user.role}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Joined</dt>
                <dd>{user.createdAt.toISOString().slice(0, 10)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  KYC authorization
                </dt>
                <dd>
                  <KycPill status={profile?.kycStatus ?? user.kycStatus} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Investor subtype
                </dt>
                <dd>{profile?.investorType ?? "Not applicable / not assigned"}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Operational summary</CardTitle>
          <CardBody>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt>Listings</dt>
                <dd className="font-semibold">{activityMetrics.propertyCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Buyer offers</dt>
                <dd className="font-semibold">{activityMetrics.offerCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Flipper resales</dt>
                <dd className="font-semibold">{activityMetrics.resaleCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Syndicate pledges</dt>
                <dd className="font-semibold">{activityMetrics.pledgeCount}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </section>

      {user.agentProfiles.length > 0 && (
        <Card>
          <CardTitle>Agent profile context</CardTitle>
          <CardBody>
            <div className="grid gap-3 md:grid-cols-2">
              {user.agentProfiles.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/admin/agents/${agent.id}`}
                  className="rounded-md border border-line p-4 hover:border-brand"
                >
                  <div className="font-semibold text-primary">{agent.agencyName}</div>
                  <div className="mt-1 text-sm text-muted">
                    {agent.complianceCode} · {agent._count.properties} listings ·{" "}
                    {agent.active ? "Profile active" : "Profile inactive"}
                  </div>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {user.kycSubmissions.length > 0 && (
        <Card>
          <CardTitle>KYC history summary</CardTitle>
          <CardBody>
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
                    className="text-sm font-semibold text-brand hover:underline"
                  >
                    Open KYC review
                  </Link>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardTitle>Recent audit history</CardTitle>
        <CardBody>
          {details.auditLogs.length === 0 ? (
            <p className="text-muted">No related audit events.</p>
          ) : (
            <div className="divide-y divide-line">
              {details.auditLogs.map((event) => (
                <div key={event.id} className="py-2 text-sm">
                  <span className="font-semibold">{event.action}</span>
                  <span className="ml-2 text-muted">{event.createdAt.toISOString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
