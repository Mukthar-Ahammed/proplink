import "server-only";

import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/authz";
import { approveKycSubmission } from "@/services/admin/kycAdminService";

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAdminPermission("VERIFICATION");
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  const result = await approveKycSubmission(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    { submissionId: id },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, submissionId: result.data.submissionId });
}
