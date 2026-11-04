import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { createFlipperOpportunity } from "@/services/flipper/flipperService";

export async function POST(request: Request) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  let body: { propertyId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body.propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  const result = await createFlipperOpportunity(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    body.propertyId,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, opportunityId: result.data.opportunityId });
}
