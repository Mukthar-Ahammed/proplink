import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { createFlipperProject } from "@/services/flipper/flipperProjectService";

export async function POST(request: Request) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  let body: { acquisitionId?: string; plannedBudgetGBP?: number; targetCompletionDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await createFlipperProject(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    {
      acquisitionId: body.acquisitionId ?? "",
      plannedBudgetGBP: body.plannedBudgetGBP,
      targetCompletionDate: body.targetCompletionDate,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, projectId: result.data.projectId });
}
