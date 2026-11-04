import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { resubmitFlipperResale } from "@/services/flipper/flipperResaleService";

// POST /api/investor/flip/resales/[id]/resubmit
// After Admin rejection, Investor resets REJECTED → DRAFT to allow edits before resubmission.
export async function POST(
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

  const result = await resubmitFlipperResale(caller, id);

  if (!result.ok) {
    const status = result.error.startsWith("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, resaleId: result.data.resaleId });
}
