import "server-only";

import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/authz";
import { getListingForModeration } from "@/services/listings/moderationService";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdminPermission("LISTING_MODERATION");
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  try {
    const listing = await getListingForModeration(id);
    return NextResponse.json(listing);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Listing not found" },
      { status: 404 },
    );
  }
}
