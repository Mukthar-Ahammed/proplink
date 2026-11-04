import "server-only";

import { z } from "zod";
import {
  KycStatus,
  KycSubmissionStatus,
  Role,
  InvestorType,
} from "@/generated/prisma/enums";

import {
  KYC_REJECTION_REASONS,
  type KycRejectionReasonCode,
} from "./kycConstants";
export { KYC_REJECTION_REASONS, type KycRejectionReasonCode };

export const rejectKycSchema = z.object({
  submissionId: z.string().min(1, "submissionId is required"),
  rejectionReason: z
    .string()
    .trim()
    .min(5, "Please select or provide a rejection reason (minimum 5 characters)")
    .max(500),
  internalNotes: z.string().trim().max(2000).optional(),
});

export type RejectKycInput = z.infer<typeof rejectKycSchema>;

export const approveKycSchema = z.object({
  submissionId: z.string().min(1, "submissionId is required"),
});

export type ApproveKycInput = z.infer<typeof approveKycSchema>;

// ─── Caller & Result Types ───────────────────────────────────────────────────

export type AdminCaller = {
  userId: string;
  role: Role;
  active: boolean;
};

export type KycAdminServiceResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Guard ────────────────────────────────────────────────────────────────────

function requireActiveAdmin(caller: AdminCaller): string | null {
  if (!caller.active) return "Account is inactive";
  if (caller.role !== Role.ADMIN) return "Only Admin accounts can perform KYC reviews";
  return null;
}

// ─── Queue Listing ────────────────────────────────────────────────────────────

export type AdminKycQueueItem = {
  id: string;
  userId: string;
  investorName: string;
  investorEmail: string;
  investorType: InvestorType | null;
  profileKycStatus: KycStatus;
  submissionStatus: KycSubmissionStatus;
  attemptNumber: number;
  submittedAt: Date | null;
  documentCount: number;
  reviewedAt: Date | null;
  rejectionReason: string | null;
};

export type AdminKycSummary = {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalCount: number;
  oldestPendingSubmittedAt: Date | null;
};

export async function getAdminKycSummary(
  caller: AdminCaller,
): Promise<KycAdminServiceResult<AdminKycSummary>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const [pendingCount, approvedCount, rejectedCount, totalCount, oldestPending] =
    await Promise.all([
      db.kycSubmission.count({ where: { status: KycSubmissionStatus.SUBMITTED } }),
      db.kycSubmission.count({ where: { status: KycSubmissionStatus.APPROVED } }),
      db.kycSubmission.count({ where: { status: KycSubmissionStatus.REJECTED } }),
      db.kycSubmission.count(),
      db.kycSubmission.findFirst({
        where: { status: KycSubmissionStatus.SUBMITTED },
        orderBy: { submittedAt: "asc" },
        select: { submittedAt: true },
      }),
    ]);

  return {
    ok: true,
    data: {
      pendingCount,
      approvedCount,
      rejectedCount,
      totalCount,
      oldestPendingSubmittedAt: oldestPending?.submittedAt ?? null,
    },
  };
}

export type AdminKycQueueParams = {
  status?: KycSubmissionStatus | "ALL";
  investorType?: InvestorType | "ALL";
  search?: string;
  sort?: "oldest" | "newest";
  page?: number;
  pageSize?: number;
};

export type AdminKycQueueResult = {
  items: AdminKycQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function getAdminKycQueue(
  caller: AdminCaller,
  params?: AdminKycQueueParams,
): Promise<KycAdminServiceResult<AdminKycQueueResult>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const statusFilter =
    params?.status && params.status !== "ALL"
      ? { status: params.status }
      : params?.status === "ALL"
      ? {}
      : { status: KycSubmissionStatus.SUBMITTED }; // Default queue shows pending SUBMITTED

  const investorTypeFilter =
    params?.investorType && params.investorType !== "ALL"
      ? {
          user: {
            authProfile: {
              investorType: params.investorType,
            },
          },
        }
      : {};

  const searchFilter = params?.search?.trim()
    ? {
        user: {
          OR: [
            { name: { contains: params.search.trim(), mode: "insensitive" as const } },
            { email: { contains: params.search.trim(), mode: "insensitive" as const } },
          ],
        },
      }
    : {};

  const whereClause = {
    ...statusFilter,
    ...investorTypeFilter,
    ...searchFilter,
  };

  const sortOrder = params?.sort === "newest" ? ("desc" as const) : ("asc" as const);
  const page = Math.max(1, params?.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, params?.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const [total, submissions] = await Promise.all([
    db.kycSubmission.count({ where: whereClause }),
    db.kycSubmission.findMany({
      where: whereClause,
      orderBy: { submittedAt: sortOrder },
      skip,
      take: pageSize,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            kycStatus: true,
            authProfile: {
              select: { investorType: true, kycStatus: true },
            },
            kycSubmissions: {
              select: { id: true, createdAt: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        documents: { select: { id: true } },
      },
    }),
  ]);

  const queueItems: AdminKycQueueItem[] = submissions.map((sub) => {
    const userSubmissions = sub.user.kycSubmissions;
    const attemptIndex = userSubmissions.findIndex((s) => s.id === sub.id);
    const attemptNumber = attemptIndex >= 0 ? attemptIndex + 1 : 1;

    return {
      id: sub.id,
      userId: sub.userId,
      investorName: sub.user.name,
      investorEmail: sub.user.email,
      investorType: sub.user.authProfile?.investorType ?? null,
      profileKycStatus: sub.user.authProfile?.kycStatus ?? sub.user.kycStatus,
      submissionStatus: sub.status,
      attemptNumber,
      submittedAt: sub.submittedAt,
      documentCount: sub.documents.length,
      reviewedAt: sub.reviewedAt,
      rejectionReason: sub.rejectionReason,
    };
  });

  const totalPages = Math.ceil(total / pageSize) || 1;

  return {
    ok: true,
    data: {
      items: queueItems,
      total,
      page,
      pageSize,
      totalPages,
    },
  };
}

// ─── Submission Detail ────────────────────────────────────────────────────────

export type AdminKycAttemptHistoryItem = {
  id: string;
  attemptNumber: number;
  status: KycSubmissionStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  documentCount: number;
  isCurrent: boolean;
};

export type AdminKycSubmissionDetail = {
  id: string;
  userId: string;
  investorName: string;
  investorEmail: string;
  investorType: InvestorType | null;
  accountActive: boolean;
  profileKycStatus: KycStatus;
  submissionStatus: KycSubmissionStatus;
  attemptNumber: number;
  attemptsHistory: AdminKycAttemptHistoryItem[];
  declaration: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  internalNotes: string | null;
  documents: Array<{
    id: string;
    kind: string;
    contentType: string;
    sizeBytes: number;
    createdAt: Date;
  }>;
};

export async function getAdminKycSubmissionDetail(
  caller: AdminCaller,
  submissionId: string,
): Promise<KycAdminServiceResult<AdminKycSubmissionDetail>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const sub = await db.kycSubmission.findUnique({
    where: { id: submissionId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
          kycStatus: true,
          authProfile: {
            select: { investorType: true, kycStatus: true, active: true },
          },
          kycSubmissions: {
            select: {
              id: true,
              status: true,
              submittedAt: true,
              reviewedAt: true,
              rejectionReason: true,
              createdAt: true,
              documents: { select: { id: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      documents: {
        select: {
          id: true,
          kind: true,
          contentType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!sub) return { ok: false, error: "Submission not found" };

  const allUserSubmissions = sub.user.kycSubmissions;
  const attemptsHistory: AdminKycAttemptHistoryItem[] = allUserSubmissions.map((s, idx) => ({
    id: s.id,
    attemptNumber: idx + 1,
    status: s.status,
    submittedAt: s.submittedAt,
    reviewedAt: s.reviewedAt,
    rejectionReason: s.rejectionReason,
    documentCount: s.documents.length,
    isCurrent: s.id === sub.id,
  }));

  const currentAttemptIndex = allUserSubmissions.findIndex((s) => s.id === sub.id);
  const attemptNumber = currentAttemptIndex >= 0 ? currentAttemptIndex + 1 : 1;

  return {
    ok: true,
    data: {
      id: sub.id,
      userId: sub.userId,
      investorName: sub.user.name,
      investorEmail: sub.user.email,
      investorType: sub.user.authProfile?.investorType ?? null,
      accountActive: sub.user.active && (sub.user.authProfile?.active ?? true),
      profileKycStatus: sub.user.authProfile?.kycStatus ?? sub.user.kycStatus,
      submissionStatus: sub.status,
      attemptNumber,
      attemptsHistory,
      declaration: sub.declaration,
      submittedAt: sub.submittedAt,
      reviewedAt: sub.reviewedAt,
      reviewedByUserId: sub.reviewedByUserId,
      rejectionReason: sub.rejectionReason,
      internalNotes: sub.internalNotes,
      documents: sub.documents,
    },
  };
}

// ─── Approve KYC Submission ───────────────────────────────────────────────────

export async function approveKycSubmission(
  caller: AdminCaller,
  input: ApproveKycInput,
): Promise<KycAdminServiceResult<{ submissionId: string }>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const submission = await db.kycSubmission.findUnique({
    where: { id: input.submissionId },
    include: {
      user: {
        select: {
          id: true,
          active: true,
          kycStatus: true,
          authProfile: { select: { active: true, kycStatus: true } },
        },
      },
    },
  });

  if (!submission) return { ok: false, error: "Submission not found" };

  // Anti-Self Approval Guard
  if (submission.userId === caller.userId) {
    return { ok: false, error: "Admins cannot approve their own KYC submission" };
  }

  // Account Active Check
  const isActive = submission.user.active && (submission.user.authProfile?.active ?? true);
  if (!isActive) {
    return { ok: false, error: "Investor account is inactive. Cannot approve KYC for an inactive user." };
  }

  // State Invariant: Must be SUBMITTED and Profile PENDING
  const currentProfileStatus = submission.user.authProfile?.kycStatus ?? submission.user.kycStatus;
  if (
    submission.status !== KycSubmissionStatus.SUBMITTED ||
    currentProfileStatus !== KycStatus.PENDING
  ) {
    return {
      ok: false,
      error: "Submission is no longer pending review (only SUBMITTED attempts with PENDING profiles can be approved)",
    };
  }

  const now = new Date();

  // Atomic Update & Race Protection via conditional Raw SQL update
  const updatedCount = await db.$executeRaw`
    UPDATE public."KycSubmission"
    SET "status" = 'APPROVED'::"KycSubmissionStatus",
        "reviewedAt" = ${now},
        "reviewedByUserId" = ${caller.userId},
        "updatedAt" = ${now}
    WHERE "id" = ${input.submissionId}
      AND "status" = 'SUBMITTED'::"KycSubmissionStatus"
  `;

  if (updatedCount === 0) {
    return {
      ok: false,
      error: "Submission is no longer pending review (race condition or already decided)",
    };
  }

  // Update profiles.kycStatus & User.kycStatus
  await db.$transaction([
    db.$executeRaw`
      UPDATE public.profiles
      SET "kycStatus" = 'APPROVED'::"KycStatus",
          "updatedAt" = ${now}
      WHERE "legacyUserId" = ${submission.userId}
        AND "kycStatus" = 'PENDING'::"KycStatus"
    `,
    db.$executeRaw`
      UPDATE public."User"
      SET "kycStatus" = 'APPROVED'::"KycStatus"
      WHERE "id" = ${submission.userId}
        AND "kycStatus" = 'PENDING'::"KycStatus"
    `,
  ]);

  // Audit Event
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "KYC_APPROVED",
        entity: "KycSubmission",
        entityId: input.submissionId,
        metaJson: {
          investorUserId: submission.userId,
          approvedAt: now.toISOString(),
          reviewerUserId: caller.userId,
        },
      },
    });
  } catch (err) {
    console.error("Failed to log KYC approval audit event:", err);
  }

  return { ok: true, data: { submissionId: input.submissionId } };
}

// ─── Reject KYC Submission ────────────────────────────────────────────────────

export async function rejectKycSubmission(
  caller: AdminCaller,
  input: RejectKycInput,
): Promise<KycAdminServiceResult<{ submissionId: string }>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const parseResult = rejectKycSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      ok: false,
      error: parseResult.error.issues[0]?.message ?? "Invalid rejection parameters",
    };
  }

  const { db } = await import("@/lib/db");

  const submission = await db.kycSubmission.findUnique({
    where: { id: input.submissionId },
    include: {
      user: {
        select: {
          id: true,
          active: true,
          kycStatus: true,
          authProfile: { select: { active: true, kycStatus: true } },
        },
      },
    },
  });

  if (!submission) return { ok: false, error: "Submission not found" };

  const currentProfileStatus = submission.user.authProfile?.kycStatus ?? submission.user.kycStatus;
  if (
    submission.status !== KycSubmissionStatus.SUBMITTED ||
    currentProfileStatus !== KycStatus.PENDING
  ) {
    return {
      ok: false,
      error: "Submission is no longer pending review (only SUBMITTED attempts with PENDING profiles can be rejected)",
    };
  }

  const now = new Date();

  // Atomic Update & Race Protection
  const updatedCount = await db.$executeRaw`
    UPDATE public."KycSubmission"
    SET "status" = 'REJECTED'::"KycSubmissionStatus",
        "reviewedAt" = ${now},
        "reviewedByUserId" = ${caller.userId},
        "rejectionReason" = ${input.rejectionReason},
        "internalNotes" = ${input.internalNotes ?? null},
        "updatedAt" = ${now}
    WHERE "id" = ${input.submissionId}
      AND "status" = 'SUBMITTED'::"KycSubmissionStatus"
  `;

  if (updatedCount === 0) {
    return {
      ok: false,
      error: "Submission is no longer pending review (race condition or already decided)",
    };
  }

  // Update profiles.kycStatus & User.kycStatus
  await db.$transaction([
    db.$executeRaw`
      UPDATE public.profiles
      SET "kycStatus" = 'REJECTED'::"KycStatus",
          "updatedAt" = ${now}
      WHERE "legacyUserId" = ${submission.userId}
        AND "kycStatus" = 'PENDING'::"KycStatus"
    `,
    db.$executeRaw`
      UPDATE public."User"
      SET "kycStatus" = 'REJECTED'::"KycStatus"
      WHERE "id" = ${submission.userId}
        AND "kycStatus" = 'PENDING'::"KycStatus"
    `,
  ]);

  // Audit Event
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "KYC_REJECTED",
        entity: "KycSubmission",
        entityId: input.submissionId,
        metaJson: {
          investorUserId: submission.userId,
          rejectedAt: now.toISOString(),
          rejectionReason: input.rejectionReason,
          reviewerUserId: caller.userId,
        },
      },
    });
  } catch (err) {
    console.error("Failed to log KYC rejection audit event:", err);
  }

  return { ok: true, data: { submissionId: input.submissionId } };
}

// ─── Secure Admin Document Presigned Download ─────────────────────────────────

export async function presignAdminKycDocumentView(
  caller: AdminCaller,
  documentId: string,
): Promise<KycAdminServiceResult<{ url: string }>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const doc = await db.kycDocument.findUnique({
    where: { id: documentId },
    select: { storageKey: true, submissionId: true },
  });

  if (!doc) return { ok: false, error: "Document not found" };

  // Enforce private server-authenticated path for Admin document access
  const viewUrl = `/uploads/dev/${doc.storageKey}`;
  return { ok: true, data: { url: viewUrl } };
}

