import "server-only";

import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/authz";
import { getAdminKycSubmissionDetail } from "@/services/admin/kycAdminService";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdminPermission("VERIFICATION");
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  const result = await getAdminKycSubmissionDetail(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json(result.data);
}
