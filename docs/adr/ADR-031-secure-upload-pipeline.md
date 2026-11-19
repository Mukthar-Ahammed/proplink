# ADR-031: Secure upload pipeline

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 1 Task 12 (carried from Phase 0; required before any upload in Phases
1–2): authenticated upload to a private quarantine bucket, magic-byte MIME and
size validation, malware scan (`MalwareScanProvider`, ClamAV and mock),
promotion to the private bucket with a UUID filename, downloads only through
short-lived signed URLs after an access check with `Content-Disposition:
attachment` and `nosniff`, Admin-configurable limits (default 100 MB),
per-user quotas, an EICAR test. Owner default: all formats and sizes accepted;
block nothing by type but scan everything; never execute or inline-render
(except sandboxed previews of verified images). Production uploads stay
disabled until this passes.

## Decision

- **Upload** `POST /api/uploads/files`: the raw body is the file
  (`X-File-Name`, `X-Upload-Purpose`); `requireUser`; read with a hard cap at
  the configured maximum (oversize is cut off, not buffered); per-user quota
  (quarantined + available bytes); proxy rate limit (10 per 10 minutes).
- **Pipeline** (`src/services/uploads/pipeline.ts`): write to quarantine
  `quarantine/<uuid>` and record the row → magic-byte detection; a declared
  type we can recognise must match the bytes (executables only as
  `application/octet-stream`); unknown types are accepted → scan → infected:
  delete, `REJECTED_MALWARE`, audited; scanner error: delete, `SCAN_FAILED`
  (fail closed) → clean: write `files/<uuid>` to private storage, delete from
  quarantine, `AVAILABLE`.
- **Scanner**: clamd's `INSTREAM` TCP protocol directly (`tcp://host:3310`),
  avoiding an extra REST wrapper; mock flags EICAR.
- **Storage**: `ObjectStore` with two private S3 buckets (SSE on put), local
  disk for development, memory for tests. Keys are server-generated and
  validated; the database ties each row's key to its own UUID.
- **Downloads**: `createDownloadLink` checks access (Phase 1: owner or Admin;
  later phases add relationships here), then signs
  `{file, user, disposition, expiry}` with HMAC (5 minutes). `GET
/api/files/download` requires the same signed-in user, then serves
  `application/octet-stream` as an attachment with `nosniff`, `private,
no-store`, a sandboxing CSP and same-origin CORP. Inline is honoured only for
  verified JPEG/PNG/WebP. Missing and not-yours both return 404.
  - Our own signed route rather than S3 presigned GETs: no bucket exposure, the
    session binding, and no new presigner dependency.
- **Limits**: `upload_settings` (single row; default 100 MB per file, 2 GB per
  user) edited at `/admin/settings/uploads`, audited.
- **Enablement**: on in development (mocks); production only with
  `UPLOADS_ENABLED=true`, which the env schema refuses without S3 quarantine and
  private buckets and ClamAV.

## Consequences

- Task 8 (profile photos) and every later upload use this pipeline.
- Large files are held in memory during the request (up to the limit). If
  limits grow well beyond 100 MB, switch to streaming to quarantine.
- Rollback drops the tables; stored objects must be removed separately.
