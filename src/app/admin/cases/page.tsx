import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { listCases } from "@/services/admin/cases";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Cases | PropLink", robots: { index: false } };

const SUBJECT: Record<string, string> = {
  CHAT: "Chat",
  REVIEW: "Review",
  LISTING: "Listing",
  USER: "Member",
};
const time = (value: Date) => value.toISOString().slice(0, 16).replace("T", " ");

/** Case management (Phase 6 Task 3, ADR-059): reports of chats, reviews, listings and members. */
export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string; overdue?: string }>;
}) {
  const session = await requireAdminPagePermission("CASE_MANAGEMENT");
  const params = await searchParams;
  const cases = await listCases(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    { status: params.status, mine: params.mine === "1", overdue: params.overdue === "1" },
  );
  const now = new Date();
  const filters = [
    { label: "Open", href: "/admin/cases" },
    { label: "Mine", href: "/admin/cases?mine=1" },
    { label: "Overdue", href: "/admin/cases?overdue=1" },
    { label: "Resolved", href: "/admin/cases?status=RESOLVED" },
    { label: "Closed", href: "/admin/cases?status=CLOSED" },
  ];
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Cases"
        description="Reports of chats, reviews, listings and members. Each case has an owner, notes, evidence links, a deadline by priority (high 4 hours, normal 24, low 72) and a written resolution."
      />
      <nav aria-label="Case filters" className="flex flex-wrap gap-2 text-sm">
        {filters.map((filter) => (
          <Link
            key={filter.href}
            href={filter.href}
            className="rounded-full border border-line bg-white px-3 py-1 text-primary hover:bg-surface"
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      <Card>
        <CardBody>
          {cases.length === 0 ? (
            <p className="text-sm text-muted">No cases here.</p>
          ) : (
            <ul className="divide-y divide-line" data-testid="case-list">
              {cases.map((item) => {
                const overdue =
                  item.slaDueAt < now && !["RESOLVED", "CLOSED"].includes(item.status);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-3 py-3 text-sm"
                  >
                    <Link
                      href={`/admin/cases/${item.id}`}
                      className="font-semibold text-primary underline decoration-line underline-offset-4"
                    >
                      {item.title}
                    </Link>
                    <span className="text-muted">
                      {SUBJECT[item.subjectType]} ·{" "}
                      {item.status.replace("_", " ").toLowerCase()} ·{" "}
                      {item.priority.toLowerCase()} · {item.reportCount} report
                      {item.reportCount === 1 ? "" : "s"} ·{" "}
                      {item.assignee?.name ?? "unassigned"}
                    </span>
                    <span
                      className={overdue ? "font-semibold text-danger" : "text-muted"}
                    >
                      {overdue ? "Overdue since" : "Due"} {time(item.slaDueAt)} UTC
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
