import Link from "next/link";

import { requirePageRole } from "@/lib/authz";
import { PortalEmpty, PortalSection } from "@/components/portal/PortalShell";
import { listOwnListings } from "@/services/landlord/listings";

import { formatDate, STATUS_LABEL, STATUS_TONE } from "./status";

export const dynamic = "force-dynamic";
export const metadata = { title: "My properties — PropLink UK" };

/** All of the Landlord's own listings (Phase 2 Task 1, ADR-034). */
export default async function LandlordListingsPage() {
  const { user } = await requirePageRole("LANDLORD");
  const listings = await listOwnListings(user.authUserId);

  return (
    <PortalSection
      title="My properties"
      action={
        <Link
          href="/landlord/listings/new"
          className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          List a property
        </Link>
      }
    >
      {listings.length === 0 ? (
        <PortalEmpty>
          No properties yet.{" "}
          <Link
            href="/landlord/listings/new"
            className="font-semibold text-accent underline"
          >
            List your first property
          </Link>
        </PortalEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="py-2 pr-4">Property</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Submitted</th>
                <th className="py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id} className="border-t border-line align-top">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/landlord/listings/${listing.id}`}
                      className="font-medium text-primary underline decoration-line underline-offset-4"
                    >
                      {listing.title}
                    </Link>
                    {listing.city && (
                      <div className="text-xs text-muted">{listing.city}</div>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[listing.status]}`}
                    >
                      {STATUS_LABEL[listing.status]}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-xs">{formatDate(listing.submittedAt)}</td>
                  <td className="py-3 text-xs">{formatDate(listing.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalSection>
  );
}
