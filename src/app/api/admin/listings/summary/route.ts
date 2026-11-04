import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getAdminListingSummary } from "@/services/listings/moderationService";

export async function GET() {
  const authResult = await requireRole(Role.ADMIN);
  if (!authResult.ok) return authResult.response;

  try {
    const summary = await getAdminListingSummary();
    return NextResponse.json(summary);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load listing summary" },
      { status: 500 },
    );
  }
}
