import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role, KycSubmissionStatus, InvestorType } from "@/generated/prisma/enums";
import { getAdminKycQueue } from "@/services/admin/kycAdminService";

export async function GET(request: Request) {
  const authResult = await requireRole(Role.ADMIN);
  if (!authResult.ok) return authResult.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") as KycSubmissionStatus | "ALL" | null;
  const investorTypeParam = url.searchParams.get("investorType") as InvestorType | null;
  const searchParam = url.searchParams.get("search") ?? undefined;
  const sortParam = (url.searchParams.get("sort") as "oldest" | "newest" | null) ?? undefined;
  const pageParam = url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!, 10) : undefined;
  const pageSizeParam = url.searchParams.get("pageSize") ? parseInt(url.searchParams.get("pageSize")!, 10) : undefined;

  const result = await getAdminKycQueue(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    {
      status: statusParam ?? undefined,
      investorType: investorTypeParam ?? undefined,
      search: searchParam,
      sort: sortParam,
      page: pageParam,
      pageSize: pageSizeParam,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json(result.data);
}
