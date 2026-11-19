import { NextResponse } from "next/server";

import { readProfilePhoto } from "@/services/uploads/pipeline";

/**
 * Profile photo via a 5-minute signed link (Phase 1 Task 8, ADR-032), issued
 * only after the profile visibility check. Verified images only, inline in a
 * CSP sandbox with nosniff.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await readProfilePhoto(token);
  if (!result.ok)
    return NextResponse.json({ error: "Not found" }, { status: result.status });
  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": 'inline; filename="photo"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=240",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
