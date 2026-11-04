import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role, FlipperMilestoneStatus } from "@/generated/prisma/enums";
import { createProjectMilestone, updateProjectMilestone } from "@/services/flipper/flipperProjectService";

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  let body: { title?: string; description?: string; targetDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await createProjectMilestone(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    {
      projectId: id,
      title: body.title ?? "",
      description: body.description,
      targetDate: body.targetDate,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, milestoneId: result.data.milestoneId });
}

export async function PATCH(request: Request) {
  const authResult = await requireRole(Role.INVESTOR);
  if (!authResult.ok) return authResult.response;

  let body: { milestoneId?: string; status?: FlipperMilestoneStatus; title?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body.milestoneId) {
    return NextResponse.json({ error: "milestoneId is required" }, { status: 400 });
  }

  const result = await updateProjectMilestone(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      investorType: authResult.session.user.investorType ?? null,
      kycStatus: authResult.session.user.kycStatus,
      active: authResult.session.user.active ?? true,
    },
    body.milestoneId,
    {
      status: body.status,
      title: body.title,
      description: body.description,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, milestoneId: result.data.milestoneId });
}
