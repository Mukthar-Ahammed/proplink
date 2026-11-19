import "server-only";

import { notFound } from "next/navigation";
import { requireAdminPagePermission } from "@/lib/authz";
import { getListingForModeration } from "@/services/listings/moderationService";
import { ListingReviewStudioClient } from "./ListingReviewStudioClient";

export const metadata = { title: "Admin — Agent Listing Moderation Studio | PropLink" };

export default async function AgentListingReviewStudioPage(props: {
  params: Promise<{ propertyId: string }>;
}) {
  const session = await requireAdminPagePermission("LISTING_MODERATION");

  const { propertyId } = await props.params;

  const listing = await getListingForModeration(propertyId).catch(() => notFound());
  return (
    <ListingReviewStudioClient
      propertyId={propertyId}
      initialData={listing}
      currentAdminUserId={session.user.id}
    />
  );
}
