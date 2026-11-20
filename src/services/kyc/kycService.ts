import "server-only";

import { z } from "zod";
import {
  KycDocumentKind,
  KycSubmissionStatus,
  Role,
  KycStatus,
} from "@/generated/prisma/enums";
import {
  buildKycStorageKey,
  validateKycUpload,
  assertKycKeyOwnership,
  KYC_ALLOWED_CONTENT_TYPES,
  MAX_KYC_DOCUMENT_BYTES,
} from "@/services/kyc/kycStorage";

// ─── Validation schemas ──────────────────────────────────────────────────────

export const kycDocumentUploadSchema = z.object({
  kind: z.nativeEnum(KycDocumentKind, {
    error: () => ({ message: "Invalid document kind" }),
  }),
  contentType: z.enum(KYC_ALLOWED_CONTENT_TYPES as unknown as [string, ...string[]]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(
      MAX_KYC_DOCUMENT_BYTES,
      `File must be ≤ ${MAX_KYC_DOCUMENT_BYTES / (1024 * 1024)}MB`,
    ),
  /** Filename is informational only; not stored. */
  filename: z.string().trim().min(1).max(255),
});

export type KycDocumentUploadInput = z.infer<typeof kycDocumentUploadSchema>;

export const kycSubmitSchema = z.object({
  submissionId: z.string().min(1, "submissionId is required"),
  /** Investor's own declaration, required on submission. */
  declaration: z
    .string()
    .trim()
    .min(20, "Please provide a full declaration (minimum 20 characters)")
    .max(2000),
});

export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

// ─── Result types ─────────────────────────────────────────────────────────────

export type KycPresignResult =
  | {
      ok: true;
      storageKey: string;
      uploadUrl: string;
      fields: Record<string, string>;
      fileFieldName: string;
    }
  | { ok: false; error: string };

export type KycServiceResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string };

// ─── Caller identity (slim, pre-verified by auth()) ──────────────────────────

export type KycCaller = {
  /** Legacy CUID used by Prisma business tables. */
  userId: string;
  role: Role;
  kycStatus: KycStatus;
  active: boolean;
};

// ─── Guard ────────────────────────────────────────────────────────────────────

function requireActiveInvestor(caller: KycCaller): string | null {
  if (!caller.active) return "Account is inactive";
  if (caller.role !== Role.INVESTOR) return "Only Investor accounts can submit KYC";
  return null;
}

// ─── Get or create the active DRAFT submission ────────────────────────────────

/**
 * Returns an existing DRAFT, or creates a new one if:
 *   - the investor has never submitted, OR
 *   - their most recent submission is REJECTED (resubmission is allowed).
 *
 * If the investor already has a SUBMITTED or APPROVED submission, returns an
 * error — double-submission is not allowed.
 */
export async function getOrCreateKycDraft(
  caller: KycCaller,
): Promise<KycServiceResult<{ submissionId: string; documentCount: number }>> {
  const { db } = await import("@/lib/db");

  const guard = requireActiveInvestor(caller);
  if (guard) return { ok: false, error: guard };

  // Find the most recent submission for this investor.
  const latest = await db.kycSubmission.findFirst({
    where: { userId: caller.userId },
    orderBy: { createdAt: "desc" },
    include: { documents: { select: { id: true } } },
  });

  if (latest) {
    if (latest.status === KycSubmissionStatus.SUBMITTED) {
      return {
        ok: false,
        error:
          "You have a pending KYC submission already under review. Please wait for a decision before resubmitting.",
      };
    }
    if (latest.status === KycSubmissionStatus.APPROVED) {
      return {
        ok: false,
        error: "Your identity verification is already approved.",
      };
    }
    // DRAFT or REJECTED: return the draft (or create a fresh one for REJECTED).
    if (latest.status === KycSubmissionStatus.DRAFT) {
      return {
        ok: true,
        data: { submissionId: latest.id, documentCount: latest.documents.length },
      };
    }
    // REJECTED → create a new DRAFT for resubmission.
  }

  // No submission, or the last one was REJECTED — create a fresh DRAFT.
  const created = await db.kycSubmission.create({
    data: { userId: caller.userId },
  });

  return { ok: true, data: { submissionId: created.id, documentCount: 0 } };
}

// ─── Presign a KYC document upload ───────────────────────────────────────────

/**
 * Generates a presigned upload URL for a KYC document.
 * The storage key is scoped to the investor's userId to enforce ownership
 * at the storage layer.
 */
export async function presignKycDocumentUpload(
  caller: KycCaller,
  input: KycDocumentUploadInput,
): Promise<KycPresignResult> {
  const guard = requireActiveInvestor(caller);
  if (guard) return { ok: false, error: guard };

  const validationError = validateKycUpload({
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  if (validationError) return { ok: false, error: validationError };

  const storageKey = buildKycStorageKey(caller.userId, input.contentType);

  // Import storage service lazily to avoid pulling it into every bundle.
  const { storageService } = await import("@/services/storage");
  const presigned = await storageService.createPresignedUpload({
    kind: "pdf",
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    filename: input.filename,
  });

  // Override the storage key with the KYC-scoped one, and mark kind=kyc so
  // the dev upload route routes through the KYC validation path.
  return {
    ok: true,
    storageKey,
    uploadUrl: presigned.uploadUrl,
    fields: { ...presigned.fields, key: storageKey, kind: "kyc" },
    fileFieldName: presigned.fileFieldName,
  };
}

// ─── Record an uploaded document ─────────────────────────────────────────────

export type RecordKycDocumentInput = {
  submissionId: string;
  kind: KycDocumentKind;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
};

/**
 * Records a successfully uploaded KYC document in the database.
 * Enforces:
 *   - caller owns the submission (userId matches)
 *   - submission is in DRAFT state (cannot add docs to SUBMITTED/etc.)
 *   - storageKey belongs to this investor (ownership prefix check)
 */
export async function recordKycDocument(
  caller: KycCaller,
  input: RecordKycDocumentInput,
): Promise<KycServiceResult<{ documentId: string }>> {
  const { db } = await import("@/lib/db");

  const guard = requireActiveInvestor(caller);
  if (guard) return { ok: false, error: guard };

  // Ownership: key must start with kyc/<userId>/
  if (!assertKycKeyOwnership(input.storageKey, caller.userId)) {
    return {
      ok: false,
      error: "Storage key does not belong to this account",
    };
  }

  const submission = await db.kycSubmission.findUnique({
    where: { id: input.submissionId },
    select: { userId: true, status: true },
  });

  if (!submission) return { ok: false, error: "Submission not found" };
  if (submission.userId !== caller.userId) return { ok: false, error: "Forbidden" };
  if (submission.status !== KycSubmissionStatus.DRAFT) {
    return {
      ok: false,
      error: "Documents can only be added to a DRAFT submission",
    };
  }

  const validationError = validateKycUpload({
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
  if (validationError) return { ok: false, error: validationError };

  const doc = await db.kycDocument.create({
    data: {
      submissionId: input.submissionId,
      kind: input.kind,
      storageKey: input.storageKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    },
  });

  return { ok: true, data: { documentId: doc.id } };
}

// ─── Submit the KYC application ───────────────────────────────────────────────

/**
 * Transitions a DRAFT submission to SUBMITTED and atomically updates
 * profiles.kycStatus to PENDING.
 *
 * Requires:
 *   - at least one document attached
 *   - a non-empty declaration
 *   - caller owns the submission
 *   - submission is DRAFT
 *   - caller's current kycStatus is NOT_STARTED or REJECTED
 */
export async function submitKycApplication(
  caller: KycCaller,
  input: KycSubmitInput,
): Promise<KycServiceResult<{ submissionId: string }>> {
  const { db } = await import("@/lib/db");

  const guard = requireActiveInvestor(caller);
  if (guard) return { ok: false, error: guard };

  if (
    caller.kycStatus !== KycStatus.NOT_STARTED &&
    caller.kycStatus !== KycStatus.REJECTED
  ) {
    return {
      ok: false,
      error:
        "KYC application can only be submitted when status is NOT_STARTED or REJECTED",
    };
  }

  const submission = await db.kycSubmission.findUnique({
    where: { id: input.submissionId },
    include: { documents: { select: { id: true } } },
  });

  if (!submission) return { ok: false, error: "Submission not found" };
  if (submission.userId !== caller.userId) return { ok: false, error: "Forbidden" };
  if (submission.status !== KycSubmissionStatus.DRAFT) {
    return {
      ok: false,
      error: "Only a DRAFT submission can be submitted",
    };
  }
  if (submission.documents.length === 0) {
    return {
      ok: false,
      error: "At least one identity document must be uploaded before submitting",
    };
  }

  const now = new Date();

  // Atomic update: transition submission + profile kycStatus in one transaction.
  await db.$transaction([
    db.kycSubmission.update({
      where: { id: input.submissionId },
      data: {
        status: KycSubmissionStatus.SUBMITTED,
        declaration: input.declaration,
        submittedAt: now,
        updatedAt: now,
      },
    }),
    // Update BOTH profile and legacy User to keep the consistency invariant.
    db.$executeRaw`
      UPDATE public.profiles
      SET "kycStatus" = 'PENDING'::"KycStatus",
          "updatedAt" = now()
      WHERE "legacyUserId" = ${caller.userId}
        AND "kycStatus" IN ('NOT_STARTED', 'REJECTED')
    `,
    db.$executeRaw`
      UPDATE public."User"
      SET "kycStatus" = 'PENDING'::"KycStatus"
      WHERE id = ${caller.userId}
        AND "kycStatus" IN ('NOT_STARTED', 'REJECTED')
    `,
  ]);

  // Audit log (non-fatal).
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "KYC_SUBMISSION_SUBMITTED",
        entity: "KycSubmission",
        entityId: input.submissionId,
        metaJson: {
          documentCount: submission.documents.length,
          submittedAt: now.toISOString(),
        },
      },
    });
  } catch (err) {
    console.error("Failed to log KYC submission audit event:", err);
  }

  return { ok: true, data: { submissionId: input.submissionId } };
}

// ─── Get current KYC status ──────────────────────────────────────────────────

export type KycStatusSummary = {
  kycStatus: KycStatus;
  latestSubmission: {
    id: string;
    status: KycSubmissionStatus;
    submittedAt: Date | null;
    rejectionReason: string | null;
    reviewNotes: string | null;
    documentCount: number;
    createdAt: Date;
  } | null;
};

export async function getKycStatusSummary(
  caller: KycCaller,
): Promise<KycServiceResult<KycStatusSummary>> {
  const { db } = await import("@/lib/db");

  const guard = requireActiveInvestor(caller);
  if (guard) return { ok: false, error: guard };

  const [userRow, latest] = await Promise.all([
    db.user.findUnique({
      where: { id: caller.userId },
      select: { kycStatus: true },
    }),
    db.kycSubmission.findFirst({
      where: { userId: caller.userId },
      orderBy: { createdAt: "desc" },
      include: { documents: { select: { id: true } } },
    }),
  ]);

  if (!userRow) return { ok: false, error: "User not found" };

  return {
    ok: true,
    data: {
      kycStatus: userRow.kycStatus,
      latestSubmission: latest
        ? {
            id: latest.id,
            status: latest.status,
            submittedAt: latest.submittedAt,
            rejectionReason: latest.rejectionReason ?? latest.reviewNotes,
            reviewNotes: latest.reviewNotes,
            documentCount: latest.documents.length,
            createdAt: latest.createdAt,
          }
        : null,
    },
  };
}
