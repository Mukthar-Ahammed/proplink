import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { Role, UploadStatus } from "@/generated/prisma/enums";
import { getServerEnv } from "@/env";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import {
  LocalDiskObjectStore,
  S3ObjectStore,
  type ObjectStore,
} from "@/services/uploads/objectStore";
import {
  ClamdScanner,
  MalwareScannerUnavailableError,
  MockMalwareScanner,
  type MalwareScanProvider,
} from "@/services/uploads/scanner";
import { declaredTypeMatches, detectFileType } from "@/services/uploads/sniff";

/**
 * Secure upload pipeline (Phase 1 Task 12, ADR-031). Built once and reused by
 * every later upload: quarantine → magic-byte check → malware scan → promote
 * to private storage under a UUID → downloads only via short-lived signed
 * links issued after an access check.
 */

export const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_USER_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const DOWNLOAD_TTL_SECONDS = 5 * 60;
export const UPLOAD_PURPOSES = ["profile_photo", "document"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const UPLOAD_MESSAGES = {
  disabled: "Uploads are not available yet.",
  empty: "The file is empty.",
  tooLarge: "The file is larger than the limit.",
  quota: "You have reached your storage limit. Delete files you no longer need.",
  type: "The file's contents don't match its type. Check you chose the right file.",
  malware: "This file was blocked by our security scan.",
  scanUnavailable: "We couldn't check this file right now. Please try again shortly.",
} as const;

let storeOverride: ObjectStore | null = null;
let scannerOverride: MalwareScanProvider | null = null;

export function setUploadBackendsForTests(
  store: ObjectStore | null,
  scanner: MalwareScanProvider | null,
) {
  storeOverride = store;
  scannerOverride = scanner;
}

export function uploadsEnabled(): boolean {
  const env = getServerEnv();
  return env.UPLOADS_ENABLED || env.NODE_ENV !== "production";
}

function getStore(): ObjectStore {
  if (storeOverride) return storeOverride;
  const env = getServerEnv();
  if (
    env.STORAGE_PROVIDER === "s3" &&
    env.S3_QUARANTINE_BUCKET &&
    env.S3_PRIVATE_BUCKET
  ) {
    return new S3ObjectStore(
      { quarantine: env.S3_QUARANTINE_BUCKET, private: env.S3_PRIVATE_BUCKET },
      process.env.AWS_REGION ?? "eu-west-2",
    );
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Production uploads need private S3 quarantine and file buckets");
  }
  return new LocalDiskObjectStore();
}

function getScanner(): MalwareScanProvider {
  if (scannerOverride) return scannerOverride;
  const env = getServerEnv();
  if (env.MALWARE_SCANNER_PROVIDER === "clamav" && env.MALWARE_SCANNER_URL) {
    return ClamdScanner.fromUrl(env.MALWARE_SCANNER_URL);
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Production uploads need the ClamAV scanner");
  }
  return new MockMalwareScanner();
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getUploadSettings() {
  const row = await db.uploadSettings.findUnique({ where: { id: 1 } });
  return {
    maxFileBytes: row?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    userQuotaBytes: row ? Number(row.userQuotaBytes) : DEFAULT_USER_QUOTA_BYTES,
  };
}

const MB = 1024 * 1024;
const settingsSchema = z
  .object({
    maxFileMb: z.coerce.number().int().min(1).max(500),
    userQuotaMb: z.coerce
      .number()
      .int()
      .min(1)
      .max(1024 * 1024),
  })
  .strict()
  .refine((v) => v.userQuotaMb >= v.maxFileMb, {
    message: "The per-user quota must be at least the file limit",
  });

/** Admin-only (the caller has passed requireRole(ADMIN)). */
export async function updateUploadSettings(
  actor: { profileId: string; legacyUserId: string },
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the limits" };
  }
  const data = {
    maxFileBytes: parsed.data.maxFileMb * MB,
    userQuotaBytes: BigInt(parsed.data.userQuotaMb) * BigInt(MB),
    updatedBy: actor.profileId,
  };
  await db.uploadSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "UPLOAD_SETTINGS_UPDATED",
    entity: "UploadSettings",
    entityId: "1",
    meta: { maxFileMb: parsed.data.maxFileMb, userQuotaMb: parsed.data.userQuotaMb },
  });
  return { ok: true };
}

// ── Upload ────────────────────────────────────────────────────────────────

/** Keeps a readable base name only: no path, no control characters. */
export function sanitiseFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"<>|*?:]+/g, "_")
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 && cleaned !== "." && cleaned !== ".." ? cleaned : "file";
}

function normaliseDeclaredType(raw: string): string {
  const type = raw.toLowerCase().split(";")[0].trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) && type.length <= 255
    ? type
    : "application/octet-stream";
}

export type UploadResult =
  | { ok: true; fileId: string; previewable: boolean }
  | { ok: false; error: string; status: number };

export async function uploadFile(
  actor: { profileId: string; legacyUserId: string },
  input: {
    bytes: Uint8Array;
    declaredType: string;
    originalName: string;
    purpose: string;
  },
): Promise<UploadResult> {
  if (!uploadsEnabled())
    return { ok: false, error: UPLOAD_MESSAGES.disabled, status: 503 };
  const purpose = z.enum(UPLOAD_PURPOSES).safeParse(input.purpose);
  if (!purpose.success)
    return { ok: false, error: "Unknown upload purpose", status: 400 };
  if (input.bytes.length === 0)
    return { ok: false, error: UPLOAD_MESSAGES.empty, status: 400 };

  const settings = await getUploadSettings();
  if (input.bytes.length > settings.maxFileBytes) {
    return { ok: false, error: UPLOAD_MESSAGES.tooLarge, status: 413 };
  }
  const used = await db.uploadedFile.aggregate({
    where: {
      ownerId: actor.profileId,
      status: { in: [UploadStatus.QUARANTINED, UploadStatus.AVAILABLE] },
    },
    _sum: { sizeBytes: true },
  });
  if ((used._sum.sizeBytes ?? 0) + input.bytes.length > settings.userQuotaBytes) {
    return { ok: false, error: UPLOAD_MESSAGES.quota, status: 413 };
  }

  const store = getStore();
  const scanner = getScanner();
  const id = randomUUID();
  const quarantineKey = `quarantine/${id}`;
  const declaredType = normaliseDeclaredType(input.declaredType);
  await store.put("quarantine", quarantineKey, input.bytes, "application/octet-stream");
  await db.uploadedFile.create({
    data: {
      id,
      ownerId: actor.profileId,
      purpose: purpose.data,
      originalName: sanitiseFileName(input.originalName),
      declaredType,
      sizeBytes: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      storageKey: quarantineKey,
    },
  });

  const reject = async (
    status: UploadStatus,
    meta: Record<string, string | null>,
    error: string,
    httpStatus: number,
  ): Promise<UploadResult> => {
    await store.delete("quarantine", quarantineKey);
    await db.uploadedFile.update({
      where: { id },
      data: {
        status,
        scanSignature: meta.signature ?? null,
        detectedType: meta.detected ?? null,
      },
    });
    if (status !== UploadStatus.SCAN_FAILED) {
      await writeAudit({
        actorUserId: actor.legacyUserId,
        action:
          status === UploadStatus.REJECTED_MALWARE
            ? "UPLOAD_MALWARE_BLOCKED"
            : "UPLOAD_TYPE_REJECTED",
        entity: "UploadedFile",
        entityId: id,
        meta,
      });
    }
    return { ok: false, error, status: httpStatus };
  };

  const detected = detectFileType(input.bytes);
  if (!declaredTypeMatches(declaredType, detected)) {
    return reject(
      UploadStatus.REJECTED_TYPE,
      { declared: declaredType, detected: detected?.mime ?? null },
      UPLOAD_MESSAGES.type,
      415,
    );
  }

  let scan;
  try {
    scan = await scanner.scan(input.bytes);
  } catch (error) {
    if (!(error instanceof MalwareScannerUnavailableError)) throw error;
    console.error(
      JSON.stringify({ event: "uploads.scanner_unavailable", reason: error.reason }),
    );
    return reject(UploadStatus.SCAN_FAILED, {}, UPLOAD_MESSAGES.scanUnavailable, 503);
  }
  if (!scan.clean) {
    return reject(
      UploadStatus.REJECTED_MALWARE,
      { signature: scan.signature, detected: detected?.mime ?? null },
      UPLOAD_MESSAGES.malware,
      422,
    );
  }

  const fileKey = `files/${id}`;
  await store.put(
    "private",
    fileKey,
    input.bytes,
    detected?.mime ?? "application/octet-stream",
  );
  await store.delete("quarantine", quarantineKey);
  const previewable = Boolean(detected?.previewableImage);
  await db.uploadedFile.update({
    where: { id },
    data: {
      status: UploadStatus.AVAILABLE,
      storageKey: fileKey,
      detectedType: detected?.mime ?? null,
      previewable,
    },
  });
  return { ok: true, fileId: id, previewable };
}

// ── Signed downloads ──────────────────────────────────────────────────────

type TokenPayload = { f: string; u: string; d: "attachment" | "inline"; e: number };

function signingKey(): string {
  const env = getServerEnv();
  const secret =
    env.AUTH_SECURITY_SECRET ??
    (env.NODE_ENV === "production" ? undefined : "proplink-local-download-signing-only");
  if (!secret) throw new Error("AUTH_SECURITY_SECRET is required to sign downloads");
  return `download:${secret}`;
}

function sign(body: string): string {
  return createHmac("sha256", signingKey()).update(body).digest("base64url");
}

/**
 * Access check, then a link valid for 5 minutes for this user only. Phase 1
 * access: the owner and Admins; later phases add project relationships here.
 * Inline only for verified image types.
 */
export async function createDownloadLink(
  actor: { profileId: string; role: Role },
  fileId: string,
  options: { inline?: boolean } = {},
  now = Date.now(),
): Promise<{ ok: true; url: string } | { ok: false; status: number }> {
  if (!z.uuid().safeParse(fileId).success) return { ok: false, status: 404 };
  const file = await db.uploadedFile.findUnique({
    where: { id: fileId },
    select: { ownerId: true, status: true, previewable: true },
  });
  // Same answer for "missing" and "not yours": no existence oracle.
  if (!file || file.status !== UploadStatus.AVAILABLE) return { ok: false, status: 404 };
  if (file.ownerId !== actor.profileId && actor.role !== Role.ADMIN) {
    return { ok: false, status: 404 };
  }
  const payload: TokenPayload = {
    f: fileId,
    u: actor.profileId,
    d: options.inline && file.previewable ? "inline" : "attachment",
    e: Math.floor(now / 1000) + DOWNLOAD_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { ok: true, url: `/api/files/download?token=${body}.${sign(body)}` };
}

export type DownloadResult =
  | {
      ok: true;
      bytes: Uint8Array;
      fileName: string;
      contentType: string;
      disposition: "attachment" | "inline";
    }
  | { ok: false; status: number };

/** Verifies a download token for the signed-in user and loads the file. */
export async function readDownload(
  token: string,
  requesterProfileId: string,
  now = Date.now(),
): Promise<DownloadResult> {
  const [body, signature] = token.split(".");
  if (!body || !signature || token.length > 1000) return { ok: false, status: 403 };
  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, status: 403 };
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, status: 403 };
  }
  if (payload.e * 1000 < now || payload.u !== requesterProfileId) {
    return { ok: false, status: 403 };
  }
  const file = await db.uploadedFile.findUnique({
    where: { id: payload.f },
    select: {
      status: true,
      storageKey: true,
      originalName: true,
      detectedType: true,
      previewable: true,
    },
  });
  if (!file || file.status !== UploadStatus.AVAILABLE) return { ok: false, status: 404 };
  const inline = payload.d === "inline" && file.previewable;
  return {
    ok: true,
    bytes: await getStore().get("private", file.storageKey),
    fileName: file.originalName,
    contentType:
      inline && file.detectedType ? file.detectedType : "application/octet-stream",
    disposition: inline ? "inline" : "attachment",
  };
}
