import { NextResponse } from "next/server";

import { requireUser } from "@/lib/authz";
import { partyStatement } from "@/services/projects/settlement";

/**
 * A party's project statement as a PDF (Phase 4 Task 8, ADR-050). Thin:
 * the service decides access (a party gets only their own; the project's
 * Solicitor and Admin may ask for any party's with `?party=`), so another
 * person's statement is a 404, never a leak.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireUser();
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const { user } = authz.session;
  const result = await partyStatement(
    { profileId: user.authUserId, legacyUserId: user.id, role: user.role },
    id,
    new URL(request.url).searchParams.get("party"),
  );
  if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
