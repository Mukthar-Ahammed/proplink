import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import {
  getFlipperResaleDetail,
  updateFlipperResaleDraft,
} from "@/services/flipper/flipperResaleService";

// GET /api/investor/flip/resales/[id]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const { id } = await params;

  const caller = {
    userId: authResult.session.user.id,
    role: authResult.session.user.role,
    investorType: authResult.session.user.investorType ?? null,
    kycStatus: authResult.session.user.kycStatus,
    active: authResult.session.user.active ?? true,
  };

  const result = await getFlipperResaleDetail(caller, id);

  if (!result.ok) {
    const status = result.error.startsWith("Forbidden") ? 403 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}

// PATCH /api/investor/flip/resales/[id] — update DRAFT resale listing
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const { id } = await params;

  let body: {
    estimatedAskingPriceGBP?: number;
    description?: string;
    declaration?: string;
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

  const result = await updateFlipperResaleDraft(caller, {
    resaleId: id,
    estimatedAskingPriceGBP: body.estimatedAskingPriceGBP,
    description: body.description,
    declaration: body.declaration,
  });

  if (!result.ok) {
    const status = result.error.startsWith("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
