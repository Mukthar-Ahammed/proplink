import "server-only";

import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/authz";
import { rejectFlipperResale } from "@/services/admin/flipperResaleAdminService";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdminPermission("LISTING_MODERATION");
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  let body: { rejectionReason?: string; internalNotes?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const result = await rejectFlipperResale(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    {
      resaleId: id,
      rejectionReason: body.rejectionReason ?? "",
      internalNotes: body.internalNotes,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data);
}
