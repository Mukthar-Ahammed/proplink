import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/authz";
import { buildDataExport } from "@/services/admin/dataExport";

export const dynamic = "force-dynamic";

/**
 * Downloads an approved GDPR export (Phase 6 Task 3, ADR-059). Case
 * permission and approval checked by the service; never cached.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireAdminPermission("CASE_MANAGEMENT");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const { user } = authz.session;
  const result = await buildDataExport(
    { profileId: user.authUserId, legacyUserId: user.id, role: user.role },
    id,
  );
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  return new NextResponse(JSON.stringify(result.data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
