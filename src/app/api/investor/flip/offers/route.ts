import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { submitFlipperOffer } from "@/services/flipper/flipperService";

export async function POST(request: Request) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  let body: { propertyId?: string; amountGBP?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await submitFlipperOffer(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    {
      propertyId: body.propertyId ?? "",
      amountGBP: body.amountGBP ?? 0,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, offerId: result.data.offerId });
}
