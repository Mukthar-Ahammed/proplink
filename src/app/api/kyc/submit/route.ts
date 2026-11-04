import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import {
  getOrCreateKycDraft,
  submitKycApplication,
  kycSubmitSchema,
} from "@/services/kyc/kycService";
import type { KycCaller } from "@/services/kyc/kycService";

/**
 * GET /api/kyc/submit
 * Get or create the active DRAFT submission for the current investor.
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

  const result = await getOrCreateKycDraft(caller);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json(result.data, { status: 200 });
}

/**
 * POST /api/kyc/submit
 * Submit the DRAFT KYC application. Transitions:
 *   submission: DRAFT → SUBMITTED
 *   profile.kycStatus: NOT_STARTED|REJECTED → PENDING
 *
 * Requires at least one document attached and a declaration statement.
 */
export async function POST(request: Request) {
  const authz = await requireRole(Role.INVESTOR);
  if (!authz.ok) return authz.response;

  const { session } = authz;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = kycSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const caller: KycCaller = {
    userId: session.user.id,
    role: session.user.role,
    kycStatus: session.user.kycStatus,
    active: true,
  };

  const result = await submitKycApplication(caller, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ submissionId: result.data.submissionId }, { status: 200 });
}
