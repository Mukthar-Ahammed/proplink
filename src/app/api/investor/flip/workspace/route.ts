import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getFlipperWorkspace } from "@/services/flipper/flipperService";

export async function GET() {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const result = await getFlipperWorkspace({
    userId: authResult.session.user.id,
    role: authResult.session.user.role,
    investorType: authResult.session.user.investorType ?? null,
    kycStatus: authResult.session.user.kycStatus,
    active: authResult.session.user.active ?? true,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json(result.data);
}
