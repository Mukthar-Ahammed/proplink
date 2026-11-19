/**
 * File type detection by magic bytes (Phase 1 Task 12, ADR-031). The declared
 * type and the filename are never trusted. All formats are accepted (owner
 * default), but a file whose bytes contradict a type we can recognise is
 * rejected, and only verified image types may ever be previewed inline.
 */

export type DetectedType = {
  mime: string;
  extension: string;
  /** Safe to show as a sandboxed inline preview (Task 8 profile photos). */
  previewableImage: boolean;
};

type Signature = DetectedType & { test: (b: Uint8Array) => boolean };

const startsWith = (b: Uint8Array, bytes: number[], offset = 0) =>
  b.length >= offset + bytes.length && bytes.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, text: string, offset = 0) =>
  startsWith(
    b,
    [...text].map((c) => c.charCodeAt(0)),
    offset,
  );

const SIGNATURES: Signature[] = [
  {
    mime: "image/jpeg",
    extension: "jpg",
    previewableImage: true,
    test: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    mime: "image/png",
    extension: "png",
    previewableImage: true,
    test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mime: "image/webp",
    extension: "webp",
    previewableImage: true,
    test: (b) => ascii(b, "RIFF") && ascii(b, "WEBP", 8),
  },
  {
    mime: "image/gif",
    extension: "gif",
    previewableImage: false,
    test: (b) => ascii(b, "GIF87a") || ascii(b, "GIF89a"),
  },
  {
    mime: "application/pdf",
    extension: "pdf",
    previewableImage: false,
    test: (b) => ascii(b, "%PDF-"),
  },
  {
    mime: "application/zip",
    extension: "zip",
    previewableImage: false,
    test: (b) =>
      startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]),
  },
  {
    mime: "application/x-msdownload",
    extension: "exe",
    previewableImage: false,
    test: (b) => ascii(b, "MZ"),
  },
  {
    mime: "video/mp4",
    extension: "mp4",
    previewableImage: false,
    test: (b) => ascii(b, "ftyp", 4),
  },
];

/** Office formats are ZIP containers; their declared types map to ZIP bytes. */
const ZIP_BASED = new Set([
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/epub+zip",
]);

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  const head = bytes.subarray(0, 64);
  const match = SIGNATURES.find((signature) => signature.test(head));
  return match
    ? {
        mime: match.mime,
        extension: match.extension,
        previewableImage: match.previewableImage,
      }
    : null;
}

/** Declared types whose bytes we can positively recognise. */
const RECOGNISABLE = new Set([
  ...SIGNATURES.map((s) => s.mime),
  "image/jpg",
  ...ZIP_BASED,
]);

/**
 * Whether the declared type is consistent with the bytes. A declared type we
 * can recognise must match; anything else (text, CSV, unknown) is accepted and
 * served as `application/octet-stream`. An executable is never accepted under
 * a non-executable declared type.
 */
export function declaredTypeMatches(
  declared: string,
  detected: DetectedType | null,
): boolean {
  const type = declared.toLowerCase().split(";")[0].trim();
  if (detected?.mime === "application/x-msdownload") {
    return ["application/x-msdownload", "application/octet-stream"].includes(type);
  }
  if (!RECOGNISABLE.has(type)) return true;
  if (!detected) return false;
  if (ZIP_BASED.has(type)) return detected.mime === "application/zip";
  if (type === "image/jpg") return detected.mime === "image/jpeg";
  return detected.mime === type;
}
