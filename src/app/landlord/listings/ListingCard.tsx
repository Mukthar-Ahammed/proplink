import Link from "next/link";

import { formatDate, STATUS_LABEL, STATUS_TONE } from "./status";
import {
  ArrowIcon,
  HomeIcon,
  IconChip,
  StatusPill,
} from "@/components/investor/InvestorUi";
import type { listOwnListings } from "@/services/landlord/listings";

type ListingSummary = Awaited<ReturnType<typeof listOwnListings>>[number];

/** One listing as a card: title, place, status and last update. */
export function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <li>
      <Link
        href={`/landlord/listings/${listing.id}`}
        className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconChip>
              <HomeIcon />
            </IconChip>
            <div className="min-w-0">
              <p className="truncate font-semibold text-primary">{listing.title}</p>
              <p className="mt-0.5 truncate text-sm text-muted">
                {listing.city || "Address to add"}
              </p>
            </div>
          </div>
          <StatusPill tone={STATUS_TONE[listing.status]}>
            {STATUS_LABEL[listing.status]}
          </StatusPill>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
          <span>Updated {formatDate(listing.updatedAt)}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-accent">
            Open
            <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </li>
  );
}
