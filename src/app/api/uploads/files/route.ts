import { NextResponse } from "next/server";

import { requireUser } from "@/lib/authz";
import {
  getUploadSettings,
  uploadFile,
  uploadsEnabled,
  UPLOAD_MESSAGES,
} from "@/services/uploads/pipeline";

/**
 * Secure upload (Phase 1 Task 12, ADR-031). The file is the raw request body;
 * `X-File-Name` (URI-encoded) and `X-Upload-Purpose` describe it. The body is
 * read with a hard cap so an oversized upload is cut off, not buffered.
 * Rate-limited by the proxy (file_upload: 10 per 10 minutes).
 */
export async function POST(request: Request) {
  const authz = await requireUser();
  if (!authz.ok) return authz.response;
  if (!uploadsEnabled()) {
    return NextResponse.json({ error: UPLOAD_MESSAGES.disabled }, { status: 503 });
  }

  const { maxFileBytes } = await getUploadSettings();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxFileBytes) {
    return NextResponse.json({ error: UPLOAD_MESSAGES.tooLarge }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: UPLOAD_MESSAGES.empty }, { status: 400 });
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxFileBytes) {
      await reader.cancel();
      return NextResponse.json({ error: UPLOAD_MESSAGES.tooLarge }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  let originalName = "file";
  try {
    originalName = decodeURIComponent(request.headers.get("x-file-name") ?? "file");
  } catch {
    originalName = "file";
  }
  const result = await uploadFile(
    { profileId: authz.session.user.authUserId, legacyUserId: authz.session.user.id },
    {
      bytes,
      declaredType: request.headers.get("content-type") ?? "application/octet-stream",
      originalName,
      purpose: request.headers.get("x-upload-purpose") ?? "",
    },
  );
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { fileId: result.fileId, previewable: result.previewable },
    { status: 201 },
  );
}
