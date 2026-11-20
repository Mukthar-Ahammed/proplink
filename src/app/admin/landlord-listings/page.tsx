import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge, type StatusTone } from "@/components/admin/StatusBadge";
import { KeyFacts, Panel } from "@/components/portal/Detail";
import { cn } from "@/lib/cn";
import { requireAdminPagePermission } from "@/lib/authz";
import {
  listReviewQueue,
  reviewQueueMetrics,
  SLA_LIMIT_MINUTES,
  SLA_TARGET_MINUTES,
  type QueueView,
  type SlaState,
} from "@/services/landlord/reviewQueue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Landlord listing review | PropLink" };

const SLA_LABEL: Record<SlaState, { label: string; tone: StatusTone }> = {
  on_track: { label: "On track", tone: "success" },
  due: { label: "Due now", tone: "warning" },
  overdue: { label: "Overdue", tone: "danger" },
};

const VIEWS: { key: QueueView; label: string; description: string }[] = [
  {
    key: "waiting",
    label: "Waiting",
    description: "Oldest first. Open a listing to claim it and decide.",
  },
  {
    key: "mine",
    label: "Held by me",
    description: "Listings you have claimed and not yet decided.",
  },
  {
    key: "decided",
    label: "Recently decided",
    description: "Approvals, change requests and rejections, with how long each took.",
  },
];

function minutes(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  return `${hours} h ${value % 60} min`;
}

/**
 * Landlord listing review queue (Phase 2 Task 3, ADR-037; business Q6).
 * Oldest first; SLA target 30 minutes, limit 60.
 */
export default async function LandlordListingQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireAdminPagePermission("LISTING_MODERATION");
  const admin = { profileId: session.user.authUserId, legacyUserId: session.user.id };
  const { view: rawView } = await searchParams;
  const view: QueueView = VIEWS.some((entry) => entry.key === rawView)
    ? (rawView as QueueView)
    : "waiting";
  const current = VIEWS.find((entry) => entry.key === view)!;
  const now = new Date();
  const [metrics, queue] = await Promise.all([
    reviewQueueMetrics(now),
    listReviewQueue(admin, view, now),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Landlord listing review"
        description={`Private listings waiting for review before verified Agents can see them. Target ${SLA_TARGET_MINUTES} minutes, limit ${SLA_LIMIT_MINUTES}.`}
        badge={
          metrics.overdue > 0
            ? { label: `${metrics.overdue} overdue`, tone: "danger" }
            : metrics.waiting > 0
              ? { label: `${metrics.waiting} waiting`, tone: "warning" }
              : { label: "Queue clear", tone: "success" }
        }
        action={
          <Link
            href="/admin/landlord-listings/new"
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-primary"
          >
            Create for a Landlord
          </Link>
        }
      />

      <KeyFacts
        className="mt-0 xl:grid-cols-6"
        items={[
          {
            label: "Waiting",
            value: String(metrics.waiting),
            hint: `${metrics.unclaimed} unclaimed`,
          },
          {
            label: "Overdue",
            value: String(metrics.overdue),
            hint: `Over ${SLA_LIMIT_MINUTES} min`,
          },
          {
            label: "Oldest waiting",
            value: minutes(metrics.waiting > 0 ? metrics.oldestMinutes : null),
          },
          { label: `Decided, ${metrics.days} days`, value: String(metrics.decided) },
          {
            label: "Within 60 min",
            value: metrics.withinLimitPct === null ? "—" : `${metrics.withinLimitPct}%`,
            hint: `Last ${metrics.days} days`,
          },
          {
            label: "Median / p90",
            value: `${minutes(metrics.medianMinutes)} / ${minutes(metrics.p90Minutes)}`,
            hint: "Submitted to decided",
          },
        ]}
      />

      <nav
        aria-label="Queue views"
        className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {VIEWS.map((entry) => (
          <Link
            key={entry.key}
            href={
              entry.key === "waiting"
                ? "/admin/landlord-listings"
                : `/admin/landlord-listings?view=${entry.key}`
            }
            aria-current={entry.key === view ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
              entry.key === view
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:border-line hover:text-primary",
            )}
          >
            {entry.label}
            {entry.key === "waiting" ? (
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">
                {metrics.waiting}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      <Panel
        title={current.label}
        description={current.description}
        tone={view === "waiting" && metrics.overdue > 0 ? "attention" : "default"}
      >
        {view === "decided" ? (
          queue.decided.length === 0 ? (
            <p className="text-sm text-muted">No decisions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="py-2 pr-4">Listing</th>
                    <th className="py-2 pr-4">Decision</th>
                    <th className="py-2 pr-4">Time to decide</th>
                    <th className="py-2">Reviewer</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.decided.map((review) => (
                    <tr key={review.id} className="border-t border-line align-top">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/admin/landlord-listings/${review.listing.id}`}
                          className="font-semibold text-primary underline-offset-2 hover:underline"
                        >
                          {review.listing.title}
                        </Link>
                        {review.reason && (
                          <p className="mt-1 text-xs text-muted">{review.reason}</p>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={review.decision} />
                      </td>
                      <td className="py-3 pr-4">
                        {minutes(review.minutes)}
                        {review.minutes > SLA_LIMIT_MINUTES && (
                          <span className="ml-2 text-xs text-danger">over limit</span>
                        )}
                      </td>
                      <td className="py-3">{review.reviewer.name ?? "Admin"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : queue.waiting.length === 0 ? (
          <p className="text-sm text-muted">Nothing waiting.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="py-2 pr-4">Listing</th>
                  <th className="py-2 pr-4">Waiting</th>
                  <th className="py-2 pr-4">Held by</th>
                  <th className="py-2">Landlord</th>
                </tr>
              </thead>
              <tbody>
                {queue.waiting.map((listing) => (
                  <tr
                    key={listing.id}
                    className="border-t border-line align-top"
                    data-testid={`review-row-${listing.id}`}
                  >
                    <td className="py-3 pr-4">
                      <Link
                        href={`/admin/landlord-listings/${listing.id}`}
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        {listing.title}
                      </Link>
                      <div className="text-xs text-muted">
                        {[listing.city, listing.postcode].filter(Boolean).join(", ") ||
                          "—"}
                        {listing.resubmission && " · resubmitted"}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge
                        status={listing.sla.state}
                        label={`${SLA_LABEL[listing.sla.state].label} · ${minutes(listing.sla.minutes)}`}
                        tone={SLA_LABEL[listing.sla.state].tone}
                      />
                    </td>
                    <td className="py-3 pr-4">
                      {listing.claimer
                        ? listing.claimer.id === admin.profileId
                          ? "You"
                          : (listing.claimer.name ?? "Another Admin")
                        : "Unclaimed"}
                    </td>
                    <td className="py-3">{listing.owner.name ?? "Landlord"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
