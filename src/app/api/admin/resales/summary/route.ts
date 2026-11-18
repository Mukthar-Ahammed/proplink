import "server-only";

import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/authz";
import { getAdminResaleSummary } from "@/services/admin/flipperResaleAdminService";

export async function GET() {
  const authResult = await requireAdminPermission("LISTING_MODERATION");
  if (!authResult.ok) return authResult.response;

  const result = await getAdminResaleSummary({
    userId: authResult.session.user.id,
    role: authResult.session.user.role,
    active: authResult.session.user.active ?? true,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json(result.data);
}
