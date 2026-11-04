import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getAdminResaleSummary } from "@/services/admin/flipperResaleAdminService";

export async function GET() {
  const authResult = await requireRole(Role.ADMIN);
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
