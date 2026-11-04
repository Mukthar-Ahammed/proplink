import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { submitFlipperResale } from "@/services/flipper/flipperResaleService";

// POST /api/investor/flip/resales/[id]/submit
// Transitions DRAFT → SUBMITTED. Investor cannot go directly to APPROVED.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const { id } = await params;

  let body: { declaration?: string };
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

  const result = await submitFlipperResale(caller, {
    resaleId: id,
    declaration: body.declaration ?? "",
  });

  if (!result.ok) {
    const status = result.error.startsWith("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, resaleId: result.data.resaleId });
}
