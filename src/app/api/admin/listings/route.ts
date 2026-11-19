import "server-only";

import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/authz";
import { PropertyStatus } from "@/generated/prisma/enums";
import { getAdminListingQueue } from "@/services/listings/moderationService";

export async function GET(request: Request) {
  const authResult = await requireAdminPermission("LISTING_MODERATION");
  if (!authResult.ok) return authResult.response;

  const url = new URL(request.url);
  const statusParam =
    (url.searchParams.get("status") as PropertyStatus | "REJECTED" | "ALL" | null) ??
    undefined;
  const searchParam = url.searchParams.get("search") ?? undefined;
  const sortParam =
    (url.searchParams.get("sort") as "oldest" | "newest" | null) ?? undefined;
  const pageParam = url.searchParams.get("page")
    ? parseInt(url.searchParams.get("page")!, 10)
    : undefined;
  const pageSizeParam = url.searchParams.get("pageSize")
    ? parseInt(url.searchParams.get("pageSize")!, 10)
    : undefined;

  try {
    const result = await getAdminListingQueue({
      status: statusParam,
      search: searchParam,
      sort: sortParam,
      page: pageParam,
      pageSize: pageSizeParam,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load listing queue" },
      { status: 500 },
    );
  }
}
