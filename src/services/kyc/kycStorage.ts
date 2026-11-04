import "server-only";

import { randomUUID } from "node:crypto";
import { ALLOWED_PDF_TYPES, ALLOWED_IMAGE_TYPES } from "@/services/storage/validation";

/** Maximum KYC document size: 20 MB (matches bucket policy). */
export const MAX_KYC_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Allowed content types for KYC documents. */
export const KYC_ALLOWED_CONTENT_TYPES = [
  ...ALLOWED_PDF_TYPES,
  ...ALLOWED_IMAGE_TYPES,
] as const;

export type KycAllowedContentType = (typeof KYC_ALLOWED_CONTENT_TYPES)[number];

/**
 * Build the private storage key for a KYC document.
 * Pattern: kyc/<userId>/<uuid>.<ext>
 *
 * This prefix is enforced by the Supabase Storage RLS policy which verifies
 * path[1] = 'kyc' and path[2] = legacyUserId before allowing upload.
 */
export function buildKycStorageKey(userId: string, contentType: string): string {
  const ext = KYC_EXT_BY_CONTENT_TYPE[contentType as KycAllowedContentType] ?? "bin";
  return `kyc/${userId}/${randomUUID()}.${ext}`;
}

const KYC_EXT_BY_CONTENT_TYPE: Record<KycAllowedContentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Validates KYC document upload parameters server-side.
 * Returns null on success, or an error string on failure.
 */
export function validateKycUpload(params: {
  contentType: string;
  sizeBytes: number;
}): string | null {
  const allowed: readonly string[] = KYC_ALLOWED_CONTENT_TYPES;
  if (!allowed.includes(params.contentType)) {
    return `Allowed document types are: ${KYC_ALLOWED_CONTENT_TYPES.join(", ")}`;
  }
  if (params.sizeBytes <= 0) {
    return "File size must be positive";
  }
  if (params.sizeBytes > MAX_KYC_DOCUMENT_BYTES) {
    return `KYC documents must be ≤ ${MAX_KYC_DOCUMENT_BYTES / (1024 * 1024)}MB`;
  }
  return null;
}

/**
 * Verifies that a storage key belongs to the given user and has the correct
 * kyc/<userId>/... prefix. Used to reject tampered keys.
 */
export function assertKycKeyOwnership(storageKey: string, userId: string): boolean {
  const expected = `kyc/${userId}/`;
  return storageKey.startsWith(expected);
}

/** Regex pattern for a valid KYC storage key. */
export const KYC_KEY_PATTERN =
  /^kyc\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/;
