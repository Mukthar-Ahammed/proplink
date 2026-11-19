import { NextResponse } from "next/server";

import { liveDestination } from "@/services/ads/ads";
import { readAdCreative } from "@/services/uploads/pipeline";

export const dynamic = "force-dynamic";

/** A live campaign's scanned image (Phase 6 Task 1, ADR-060). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const live = await liveDestination(id);
  if (!live?.imageFileId) return new NextResponse(null, { status: 404 });
  const image = await readAdCreative(live.imageFileId);
  if (!image.ok) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=300",
    },
  });
}
