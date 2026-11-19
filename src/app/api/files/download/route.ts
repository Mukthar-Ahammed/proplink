import { NextResponse } from "next/server";

import { requireUser } from "@/lib/authz";
import { readDownload } from "@/services/uploads/pipeline";

/**
 * Signed download (Phase 1 Task 12, ADR-031). The token was issued after an
 * access check, lasts 5 minutes and works only for the user it was issued
 * to. Files are attachments with nosniff; only verified images may be shown
 * inline, and then inside a CSP sandbox.
 */
export async function GET(request: Request) {
  const authz = await requireUser();
  if (!authz.ok) return authz.response;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await readDownload(token, authz.session.user.authUserId);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Link expired or not valid" },
      { status: result.status },
    );
  }
  const encoded = encodeURIComponent(result.fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.bytes.length),
      "Content-Disposition": `${result.disposition}; filename="file"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
