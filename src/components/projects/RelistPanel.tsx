import Link from "next/link";

import { ActionButton } from "@/components/projects/ActionButton";
import { relistAction } from "@/components/projects/worksActions";
import { formatPence } from "@/services/projects/common";
import type { retailListingFor } from "@/services/projects/relist";

const input = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";
const STATUS: Record<string, string> = {
  DRAFT: "Returned by PropLink",
  PENDING_REVIEW: "Waiting for PropLink review",
  LIVE: "Live on the Retail Buyer portal",
  UNDER_OFFER: "Under offer",
  SOLD: "Sold",
};

/**
 * Phase 5 Task 1: the project's Agent re-lists the completed property for
 * sale; PropLink reviews it before it goes live (ADR-052).
 */
export function RelistPanel({
  projectId,
  path,
  listing,
}: {
  projectId: string;
  path: string;
  listing: Awaited<ReturnType<typeof retailListingFor>>;
}) {
  if (listing) {
    return (
      <p className="text-sm text-body" data-testid="retail-listing">
        {listing.property.title} · {formatPence(BigInt(listing.property.askingPriceGBP))}{" "}
        · {STATUS[listing.property.status]}
        {listing.property.rejectionReason && ` · ${listing.property.rejectionReason}`}
        {(listing.property.status === "LIVE" ||
          listing.property.status === "UNDER_OFFER") && (
          <>
            {" "}
            ·{" "}
            <Link
              href={`/marketplace/${listing.propertyId}`}
              className="text-primary underline"
            >
              View the public listing
            </Link>
          </>
        )}
      </p>
    );
  }
  return (
    <ActionButton
      action={relistAction}
      hidden={{ projectId, path }}
      label="List for sale"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="title" required placeholder="Listing title" className={input} />
        <input
          name="askingPrice"
          required
          placeholder="Asking price (£)"
          className={input}
        />
        <input
          name="region"
          required
          placeholder="Region (e.g. West Yorkshire)"
          className={input}
        />
        <input
          name="bedrooms"
          type="number"
          min={0}
          required
          placeholder="Bedrooms"
          className={input}
        />
        <select name="propertyType" className={input} aria-label="Property type">
          <option value="RESIDENTIAL">Residential</option>
          <option value="COMMERCIAL">Commercial</option>
          <option value="HMO">HMO</option>
          <option value="LAND">Land</option>
        </select>
        <select name="epcRating" className={input} aria-label="EPC rating">
          {["A", "B", "C", "D", "E", "F", "G"].map((band) => (
            <option key={band} value={band}>
              EPC {band}
            </option>
          ))}
        </select>
        <textarea
          name="description"
          required
          rows={3}
          placeholder="Description for buyers"
          className={`${input} sm:col-span-2`}
        />
        <label className="flex items-center gap-2 text-sm text-body sm:col-span-2">
          <input type="checkbox" name="pricingSafeguardAck" />
          The seller has been told the asking price may change after survey findings, and
          any change will be disclosed to buyers before offers are accepted.
        </label>
      </div>
    </ActionButton>
  );
}
