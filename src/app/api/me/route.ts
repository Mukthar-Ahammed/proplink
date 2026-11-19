import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { eraseMember } from "@/services/privacy/erasure";

/**
 * GDPR right-to-erasure. Anonymises the calling user's account;
 * KYC records are retained (UK AML, 5 years) linked to the anonymised shell.
 * The client must sign out after calling this.
 */
export async function DELETE() {
  const authz = await requireRole(); // any authenticated user
  if (!authz.ok) return authz.response;

  // Phase 7 (ADR-065): legal holds are checked first; running obligations
  // block erasure and are listed for the member.
  const result = await eraseMember(authz.session.user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, blocking: result.blocking ?? [] },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, retained: result.retained });
}
