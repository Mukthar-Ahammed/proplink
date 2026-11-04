import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getKycStatusSummary } from "@/services/kyc/kycService";
import type { KycCaller } from "@/services/kyc/kycService";

/**
 * GET /api/kyc/status
 * Returns the authoritative KYC status (from profiles/User) and latest
 * submission summary for the authenticated investor.
 */
export async function GET() {
  const authz = await requireRole(Role.INVESTOR);
  if (!authz.ok) return authz.response;

  const { session } = authz;

  const caller: KycCaller = {
    userId: session.user.id,
    role: session.user.role,
    kycStatus: session.user.kycStatus,
    active: true,
  };

  const result = await getKycStatusSummary(caller);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json(result.data, { status: 200 });
}
