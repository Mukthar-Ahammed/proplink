import Link from "next/link";

import { requirePageRole } from "@/lib/authz";
import {
  HomeIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  PrimaryLink,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { listOwnListings } from "@/services/landlord/listings";

import { formatDate, STATUS_LABEL, STATUS_TONE } from "./status";

export const dynamic = "force-dynamic";
export const metadata = { title: "My properties — PropLink UK" };

/** All of the Landlord's own listings (Phase 2 Task 1, ADR-034). */
export default async function LandlordListingsPage() {
  const { user } = await requirePageRole("LANDLORD");
  const listings = await listOwnListings(user.authUserId);

  return (
    <section className="space-y-5">
      <InvestorSectionTitle
        title="My"
        tail="properties"
        description="Private listings: only PropLink-verified agents see them, after our review."
        action={<PrimaryLink href="/landlord/listings/new">List a property</PrimaryLink>}
      />
      {listings.length === 0 ? (
        <InvestorEmpty
          title="No properties yet"
          action={
            <PrimaryLink href="/landlord/listings/new">
              List your first property
            </PrimaryLink>
          }
        >
          Start with a title; it saves as a private draft you can finish at your own pace.
        </InvestorEmpty>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface/70 text-xs font-semibold tracking-[0.1em] text-muted uppercase">
                <tr>
                  <th className="px-6 py-3">Property</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-6 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {listings.map((listing) => (
                  <tr key={listing.id} className="transition-colors hover:bg-pale/40">
                    <td className="px-6 py-4">
                      <Link
                        href={`/landlord/listings/${listing.id}`}
                        className="flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <IconChip>
                          <HomeIcon />
                        </IconChip>
                        <span className="min-w-0">
                          <span className="block font-semibold text-primary hover:text-accent">
                            {listing.title}
                          </span>
                          <span className="text-xs text-muted">
                            {listing.city || "Address to add"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <StatusPill tone={STATUS_TONE[listing.status]}>
                        {STATUS_LABEL[listing.status]}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-4 text-xs whitespace-nowrap text-muted">
                      {formatDate(listing.submittedAt)}
                    </td>
                    <td className="px-6 py-4 text-xs whitespace-nowrap text-muted">
                      {formatDate(listing.updatedAt)}
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
