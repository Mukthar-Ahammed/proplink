import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { rejectKycSubmission } from "@/services/admin/kycAdminService";

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.ADMIN);
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  let body: { rejectionReason?: string; internalNotes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await rejectKycSubmission(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    {
      submissionId: id,
      rejectionReason: body.rejectionReason ?? "",
      internalNotes: body.internalNotes,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, submissionId: result.data.submissionId });
}
