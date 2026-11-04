import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import {
  createFlipperResaleDraft,
  listInvestorResales,
} from "@/services/flipper/flipperResaleService";

// GET /api/investor/flip/resales — list all resale listings for the authenticated investor
export async function GET() {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const caller = {
    userId: authResult.session.user.id,
    role: authResult.session.user.role,
    investorType: authResult.session.user.investorType ?? null,
    kycStatus: authResult.session.user.kycStatus,
    active: authResult.session.user.active ?? true,
  };

  const result = await listInvestorResales(caller);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json(result.data);
}

// POST /api/investor/flip/resales — create a new DRAFT resale listing
export async function POST(request: Request) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  let body: {
    projectId?: string;
    estimatedAskingPriceGBP?: number;
    description?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const caller = {
    userId: authResult.session.user.id,
    role: authResult.session.user.role,
    investorType: authResult.session.user.investorType ?? null,
    kycStatus: authResult.session.user.kycStatus,
    active: authResult.session.user.active ?? true,
  };

  const result = await createFlipperResaleDraft(caller, {
    projectId: body.projectId ?? "",
    estimatedAskingPriceGBP: body.estimatedAskingPriceGBP ?? 0,
    description: body.description,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, resaleId: result.data.resaleId }, { status: 201 });
}
