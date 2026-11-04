import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { z } from "zod";
import { recordKycDocument } from "@/services/kyc/kycService";
import { KycDocumentKind } from "@/generated/prisma/enums";
import type { KycCaller } from "@/services/kyc/kycService";

const recordDocumentSchema = z.object({
  submissionId: z.string().min(1),
  kind: z.nativeEnum(KycDocumentKind),
  storageKey: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

/**
 * POST /api/kyc/documents
 * Record a successfully uploaded KYC document.
 * The client must have already uploaded the file to storage using the
 * presign URL from /api/kyc/documents/presign, then call this endpoint
 * with the confirmed storageKey.
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

  const parsed = recordDocumentSchema.safeParse(body);
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
    active: true,
  };

  const result = await recordKycDocument(caller, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ documentId: result.data.documentId }, { status: 201 });
}
