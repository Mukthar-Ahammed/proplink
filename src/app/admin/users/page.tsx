import { isRecentlyAuthenticated, REAUTH_MESSAGE } from "@/services/auth/mfa";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { requireAdminPagePermission, requireAdminPermission } from "@/lib/authz";
import { listUsers, setUserActive } from "@/services/admin/users";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { KycPill } from "@/components/layout/KycPill";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AccountStateAction } from "@/components/admin/AccountStateAction";
import type { InvestorType, KycStatus, Role } from "@/generated/prisma/enums";

export const metadata = { title: "Admin — Users Directory | PropLink" };

const ROLES: Role[] = ["AGENT", "INVESTOR", "BUYER", "ADMIN"];

function pageHref(params: Record<string, string | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && key !== "page") query.set(key, value);
  }
  query.set("page", String(page));
  return `/admin/users?${query.toString()}`;
}

async function toggleActive(formData: FormData) {
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
  revalidatePath("/admin/users");
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    role?: string;
    active?: string;
    kycStatus?: string;
    investorType?: string;
    page?: string;
  }>;
}) {
  await requireAdminPagePermission("SUSPENSION");
  const params = await searchParams;
  const role = ROLES.includes(params.role as Role) ? (params.role as Role) : undefined;
  const active =
    params.active === "true" ? true : params.active === "false" ? false : undefined;
  const kycStatus = ["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"].includes(
    params.kycStatus ?? "",
  )
    ? (params.kycStatus as KycStatus)
    : undefined;
  const investorType = ["FLIPPER", "SYNDICATE", "BOTH"].includes(
    params.investorType ?? "",
  )
    ? (params.investorType as InvestorType)
    : undefined;
  const { users, total, page, pageSize } = await listUsers({
    q: params.q,
    role,
    active,
    kycStatus,
    investorType,
    page: params.page ? Number(params.page) : 1,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Users Directory"
        description="Inspect registered accounts, manage role permissions, and control account activation states."
      />

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4 shadow-xs"
      >
        <div className="flex-1 min-w-[200px]">
          <label
            htmlFor="q"
            className="block text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Search Directory
          </label>
          <input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search by email or name..."
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="role"
            className="block text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Filter Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue={role ?? ""}
            className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="active"
            className="block text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Account state
          </label>
          <select
            id="active"
            name="active"
            defaultValue={params.active ?? ""}
            className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">All states</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="investorType"
            className="block text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Investor subtype
          </label>
          <select
            id="investorType"
            name="investorType"
            defaultValue={params.investorType ?? ""}
            className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">All subtypes</option>
            <option value="FLIPPER">Flipper</option>
            <option value="SYNDICATE">Syndicate</option>
            <option value="BOTH">Both</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="kycStatus"
            className="block text-xs font-semibold uppercase tracking-wider text-muted"
          >
            KYC state
          </label>
          <select
            id="kycStatus"
            name="kycStatus"
            defaultValue={params.kycStatus ?? ""}
            className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">All KYC</option>
            <option value="NOT_STARTED">Not started</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-accent transition-colors"
        >
          Filter
        </button>
        <Link
          href="/admin/users"
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-secondary hover:border-brand"
        >
          Clear filters
        </Link>
      </form>

      <DataTable
        label="Users"
        rows={users}
        rowKey={(u) => u.id}
        emptyMessage="No matching users found in directory."
        columns={[
          {
            key: "user",
            header: "User Details",
            render: (u) => (
              <div>
                <a
                  href={`/admin/users/${u.id}`}
                  className="font-semibold text-primary hover:underline"
                >
                  {u.name}
                </a>
                <div className="text-xs text-muted">{u.email}</div>
              </div>
            ),
          },
          {
            key: "subtype",
            header: "Subtype",
            render: (u) =>
              u.authProfile?.investorType ? (
                <Badge tone="intel">{u.authProfile.investorType}</Badge>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
          {
            key: "role",
            header: "Role",
            render: (u) => (
              <Badge
                tone={(u.authProfile?.role ?? u.role) === "ADMIN" ? "intel" : "default"}
              >
                {u.authProfile?.role ?? u.role}
              </Badge>
            ),
          },
          {
            key: "kyc",
            header: "KYC Authorization",
            render: (u) => <KycPill status={u.authProfile?.kycStatus ?? u.kycStatus} />,
          },
          {
            key: "status",
            header: "Account State",
            render: (u) => (
              <StatusBadge
                status={(u.authProfile?.active ?? u.active) ? "ACTIVE" : "DEACTIVATED"}
              />
            ),
          },
          {
            key: "joined",
            header: "Registered",
            render: (u) => (
              <span className="text-xs text-muted">
                {u.createdAt.toISOString().slice(0, 10)}
              </span>
            ),
          },
          {
            key: "actions",
            header: "Action",
            className: "text-right",
            render: (u) => (
              <AccountStateAction
                userId={u.id}
                active={u.authProfile?.active ?? u.active}
                action={toggleActive}
              />
            ),
          },
        ]}
      />

      <div className="flex items-center justify-between text-xs text-muted pt-2">
        <span>
          Showing {users.length} of {total} user{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-3">
          <span>
            Page {page} of {pages}
          </span>
          {page > 1 && (
            <Link
              href={pageHref(params, page - 1)}
              className="rounded border border-line px-2 py-1 text-secondary hover:border-brand"
            >
              Previous
            </Link>
          )}
          {page < pages && (
            <Link
              href={pageHref(params, page + 1)}
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
