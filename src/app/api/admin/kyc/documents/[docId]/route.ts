import "server-only";

import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/authz";
import { presignAdminKycDocumentView } from "@/services/admin/kycAdminService";

export async function GET(
  _request: Request,
  props: { params: Promise<{ docId: string }> },
) {
  const authResult = await requireAdminPermission("VERIFICATION");
  if (!authResult.ok) return authResult.response;

  const { docId } = await props.params;

  const result = await presignAdminKycDocumentView(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    docId,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ url: result.data.url });
}
