import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role, FlipperCostCategory } from "@/generated/prisma/enums";
import {
  addFlipperProjectCost,
  removeFlipperProjectCost,
} from "@/services/flipper/flipperProjectService";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  let body: {
    category?: FlipperCostCategory;
    description?: string;
    amountGBP?: number;
    incurredAt?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await addFlipperProjectCost(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    {
      projectId: id,
      category: body.category,
      description: body.description ?? "",
      amountGBP: body.amountGBP ?? 0,
      incurredAt: body.incurredAt,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, costId: result.data.costId });
}

export async function DELETE(request: Request) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const url = new URL(request.url);
  const costId = url.searchParams.get("costId");
  if (!costId) {
    return NextResponse.json({ error: "costId is required" }, { status: 400 });
  }

  const result = await removeFlipperProjectCost(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    costId,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, costId: result.data.costId });
}
