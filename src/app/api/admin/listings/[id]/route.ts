import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getListingForModeration } from "@/services/listings/moderationService";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.ADMIN);
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
