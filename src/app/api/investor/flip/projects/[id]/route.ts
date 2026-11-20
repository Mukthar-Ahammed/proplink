import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getFlipperProjectDetail } from "@/services/flipper/flipperProjectService";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  const result = await getFlipperProjectDetail(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json(result.data);
}
