import "server-only";

import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getListingForModeration } from "@/services/listings/moderationService";
import { ListingReviewStudioClient } from "./ListingReviewStudioClient";

export const metadata = { title: "Admin — Agent Listing Moderation Studio | PropLink" };

export default async function AgentListingReviewStudioPage(
  props: { params: Promise<{ propertyId: string }> },
) {
  const session = await requirePageRole(Role.ADMIN);

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
