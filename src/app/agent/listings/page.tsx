import Link from "next/link";
import { requirePageRole } from "@/lib/authz";
import { listListingsForAgentUser } from "@/services/listings/listingService";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import {
  HomeIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  PenIcon,
  PrimaryLink,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { SECONDARY_SM } from "@/app/landlord/listings/ui";
import type { PropertyStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Agent — Listings" };

const STATUS_LABEL: Record<PropertyStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "In review",
  LIVE: "Live",
  UNDER_OFFER: "Under offer",
  SOLD: "Sold",
};

const STATUS_TONE: Record<
  PropertyStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  DRAFT: "neutral",
  PENDING_REVIEW: "warning",
  LIVE: "success",
  UNDER_OFFER: "accent",
  SOLD: "success",
};

export default async function AgentListingsPage() {
  const session = await requirePageRole("AGENT");
  const listings = await listListingsForAgentUser(session.user.id);

  return (
    <section className="space-y-5">
      <InvestorSectionTitle
        title="Your"
        tail="listings"
        description={`${listings.length} listing${listings.length === 1 ? "" : "s"} across your agency profiles.`}
        action={<PrimaryLink href="/agent/listings/new">New listing</PrimaryLink>}
      />

      {listings.length === 0 ? (
        <InvestorEmpty
          title="No listings yet"
          action={
            <PrimaryLink href="/agent/listings/new">
              Create your first listing
            </PrimaryLink>
          }
        >
          Create your first one. It saves as a draft until you submit it for review.
        </InvestorEmpty>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
          {/* Focusable named region: on a phone the table scrolls sideways, and a
              keyboard user must be able to reach it (axe: scrollable-region-focusable). */}
          <div
            role="region"
            aria-label="Your listings"
            tabIndex={0}
            className="relative overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          >
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-line bg-surface/70 text-xs font-semibold tracking-[0.1em] text-muted uppercase">
                <tr>
                  <th className="px-6 py-3">Listing</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Asking price</th>
                  <th className="px-4 py-3">Views</th>
                  <th className="px-4 py-3">Saves</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {listings.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-pale/40">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <IconChip>
                          <HomeIcon />
                        </IconChip>
                        <div className="min-w-0">
                          <p className="font-semibold text-primary">{p.title}</p>
                          <p className="text-xs text-muted">
                            {p.city}, {p.postcode}
                          </p>
                          {p.status === "DRAFT" && p.rejectionReason && (
                            <p className="mt-1 text-xs font-medium text-danger">
                              Rejected: {p.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <StatusPill tone={STATUS_TONE[p.status]}>
                        {STATUS_LABEL[p.status]}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-4 font-semibold whitespace-nowrap text-primary tabular-nums">
                      {formatPenceGBP(p.askingPriceGBP)}
                    </td>
                    {/* Task 2.6 analytics. `viewCount` is a denormalised counter on
                        Property (incremented once per session by the view beacon);
                        saves are counted live from the `SavedProperty` join rows. */}
                    <td className="px-4 py-4 text-body tabular-nums">
                      <span data-testid={`views-${p.id}`}>{p.viewCount}</span>
                    </td>
                    <td className="px-4 py-4 text-body tabular-nums">
                      <span data-testid={`saves-${p.id}`}>{p._count.savedBy}</span>
                    </td>
                    <td className="px-4 py-4 text-xs whitespace-nowrap text-muted">
                      {p.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      {p.status === "DRAFT" ? (
                        <Link
                          href={`/agent/listings/${p.id}/edit`}
                          className={SECONDARY_SM}
                        >
                          <PenIcon className="h-4 w-4" />
                          Edit
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">View only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
