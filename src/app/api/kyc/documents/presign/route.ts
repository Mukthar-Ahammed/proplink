import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { kycDocumentUploadSchema, presignKycDocumentUpload } from "@/services/kyc/kycService";
import type { KycCaller } from "@/services/kyc/kycService";

/**
 * POST /api/kyc/documents/presign
 * Generate a presigned upload URL for a KYC document.
 * Restricted to active INVESTOR accounts.
 */
export async function POST(request: Request) {
  const authz = await requireRole(Role.INVESTOR);
  if (!authz.ok) return authz.response;

  const { session } = authz;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = kycDocumentUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const caller: KycCaller = {
    userId: session.user.id,
    role: session.user.role,
    kycStatus: session.user.kycStatus,
    active: true, // session.user is guaranteed active by auth()
  };

  const result = await presignKycDocumentUpload(caller, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json(
    {
      storageKey: result.storageKey,
      uploadUrl: result.uploadUrl,
      fields: result.fields,
      fileFieldName: result.fileFieldName,
    },
    { status: 200 },
  );
}
