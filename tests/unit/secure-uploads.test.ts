import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    uploadSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    uploadedFile: {
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

import { Role, UploadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { MemoryObjectStore } from "@/services/uploads/objectStore";
import {
  createDownloadLink,
  readDownload,
  sanitiseFileName,
  setUploadBackendsForTests,
  UPLOAD_MESSAGES,
  updateUploadSettings,
  uploadFile,
} from "@/services/uploads/pipeline";
import {
  ClamdScanner,
  EICAR_TEST_STRING,
  MalwareScannerUnavailableError,
  MockMalwareScanner,
} from "@/services/uploads/scanner";
import { declaredTypeMatches, detectFileType } from "@/services/uploads/sniff";

const mockDb = vi.mocked(db, true);
const OWNER = { profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", legacyUserId: "u1" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.7\nhello");
const EXE = new TextEncoder().encode("MZ\x90\x00 pretend executable");
const TEXT = new TextEncoder().encode("plain notes");

let store: MemoryObjectStore;

beforeEach(() => {
  vi.clearAllMocks();
  store = new MemoryObjectStore();
  setUploadBackendsForTests(store, new MockMalwareScanner());
  mockDb.uploadSettings.findUnique.mockResolvedValue(null);
  mockDb.uploadedFile.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } } as never);
});

function statusUpdates(): string[] {
  return mockDb.uploadedFile.update.mock.calls.map(
    (call) => (call[0] as { data: { status: string } }).data.status,
  );
}

describe("magic-byte detection", () => {
  it("recognises common types by content, not name", () => {
    expect(detectFileType(PNG)?.mime).toBe("image/png");
    expect(detectFileType(PDF)?.mime).toBe("application/pdf");
    expect(detectFileType(EXE)?.mime).toBe("application/x-msdownload");
    expect(detectFileType(TEXT)).toBeNull();
    expect(
      detectFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.previewableImage,
    ).toBe(true);
  });

  it.each([
    ["image/png", PNG, true],
    ["image/png", PDF, false],
    ["application/pdf", PNG, false],
    ["image/jpeg", TEXT, false],
    ["text/plain", TEXT, true],
    ["text/csv", PDF, true],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      PDF,
      false,
    ],
    ["image/png", EXE, false],
    ["text/plain", EXE, false],
    ["application/octet-stream", EXE, true],
  ])("declared %s against bytes → %s", (declared, bytes, ok) => {
    expect(declaredTypeMatches(declared, detectFileType(bytes))).toBe(ok);
  });
});

describe("uploadFile", () => {
  it("quarantines, scans and promotes a clean file under a UUID", async () => {
    const result = await uploadFile(OWNER, {
      bytes: PNG,
      declaredType: "image/png",
      originalName: "../../etc/photo.png",
      purpose: "profile_photo",
    });
    expect(result).toMatchObject({ ok: true, previewable: true });
    if (!result.ok) return;
    const created = mockDb.uploadedFile.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      id: result.fileId,
      ownerId: OWNER.profileId,
      originalName: "photo.png",
      storageKey: `quarantine/${result.fileId}`,
    });
    expect(statusUpdates()).toEqual([UploadStatus.AVAILABLE]);
    expect([...store.objects.keys()]).toEqual([`private:files/${result.fileId}`]);
  });

  it("rejects the EICAR test file and deletes it from quarantine", async () => {
    const result = await uploadFile(OWNER, {
      bytes: new TextEncoder().encode(EICAR_TEST_STRING),
      declaredType: "text/plain",
      originalName: "eicar.com",
      purpose: "document",
    });
    expect(result).toEqual({ ok: false, error: UPLOAD_MESSAGES.malware, status: 422 });
    expect(statusUpdates()).toEqual([UploadStatus.REJECTED_MALWARE]);
    expect(store.objects.size).toBe(0);
    expect(mockDb.auditLog.create.mock.calls[0][0]).toMatchObject({
      data: { action: "UPLOAD_MALWARE_BLOCKED" },
    });
  });

  it("rejects wrong magic bytes before scanning", async () => {
    const scanner = { name: "mock" as const, scan: vi.fn() };
    setUploadBackendsForTests(store, scanner);
    const result = await uploadFile(OWNER, {
      bytes: PDF,
      declaredType: "image/png",
      originalName: "not-a-photo.png",
      purpose: "profile_photo",
    });
    expect(result).toMatchObject({ ok: false, status: 415 });
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(statusUpdates()).toEqual([UploadStatus.REJECTED_TYPE]);
    expect(store.objects.size).toBe(0);
  });

  it("fails closed when the scanner is down", async () => {
    setUploadBackendsForTests(store, {
      name: "clamav",
      scan: vi.fn(async () => {
        throw new MalwareScannerUnavailableError("timeout");
      }),
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await uploadFile(OWNER, {
      bytes: PDF,
      declaredType: "application/pdf",
      originalName: "doc.pdf",
      purpose: "document",
    });
    errorLog.mockRestore();
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(statusUpdates()).toEqual([UploadStatus.SCAN_FAILED]);
    expect(store.objects.size).toBe(0);
  });

  it("enforces the size limit, the quota, purpose and non-empty files", async () => {
    mockDb.uploadSettings.findUnique.mockResolvedValue({
      maxFileBytes: 5,
      userQuotaBytes: BigInt(100),
    } as never);
    const base = {
      declaredType: "text/plain",
      originalName: "a.txt",
      purpose: "document",
    };
    await expect(uploadFile(OWNER, { ...base, bytes: TEXT })).resolves.toMatchObject({
      status: 413,
    });
    mockDb.uploadSettings.findUnique.mockResolvedValue(null);
    mockDb.uploadedFile.aggregate.mockResolvedValueOnce({
      _sum: { sizeBytes: 2 * 1024 * 1024 * 1024 },
    } as never);
    await expect(uploadFile(OWNER, { ...base, bytes: TEXT })).resolves.toMatchObject({
      error: UPLOAD_MESSAGES.quota,
    });
    await expect(
      uploadFile(OWNER, { ...base, purpose: "avatar", bytes: TEXT }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      uploadFile(OWNER, { ...base, bytes: new Uint8Array() }),
    ).resolves.toMatchObject({ status: 400 });
    expect(mockDb.uploadedFile.create).not.toHaveBeenCalled();
  });

  it("cannot be enabled without private S3 buckets and ClamAV", async () => {
    const { parseServerEnv } = await import("@/env");
    expect(() => parseServerEnv({ NODE_ENV: "development", UPLOADS_ENABLED: "true" })).toThrow(
      /private S3 provider|quarantine and private buckets|malware scanner/,
    );
    expect(
      parseServerEnv({
        NODE_ENV: "development",
        UPLOADS_ENABLED: "true",
        STORAGE_PROVIDER: "s3",
        S3_QUARANTINE_BUCKET: "q",
        S3_PRIVATE_BUCKET: "p",
        MALWARE_SCANNER_PROVIDER: "clamav",
        MALWARE_SCANNER_URL: "tcp://clamav:3310",
      }).UPLOADS_ENABLED,
    ).toBe(true);
  });

  it("sanitises original names", () => {
    expect(sanitiseFileName("C:\\Users\\me\\scan.pdf")).toBe("scan.pdf");
    expect(sanitiseFileName("a\u0000b<c>.txt")).toBe("a_b_c_.txt");
    expect(sanitiseFileName("..")).toBe("file");
    expect(sanitiseFileName("x".repeat(400))).toHaveLength(255);
  });
});

describe("signed downloads", () => {
  const FILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const now = Date.UTC(2026, 10, 18, 12);

  function available(overrides: Record<string, unknown> = {}) {
    return {
      ownerId: OWNER.profileId,
      status: UploadStatus.AVAILABLE,
      previewable: false,
      storageKey: `files/${FILE}`,
      originalName: "doc.pdf",
      detectedType: "application/pdf",
      ...overrides,
    };
  }

  async function linkFor(actor: { profileId: string; role: Role }, inline = false) {
    const result = await createDownloadLink(actor, FILE, { inline }, now);
    if (!result.ok) throw new Error(`no link: ${result.status}`);
    return new URL(result.url, "http://x").searchParams.get("token") as string;
  }

  beforeEach(async () => {
    await store.put("private", `files/${FILE}`, PDF);
    mockDb.uploadedFile.findUnique.mockResolvedValue(available() as never);
  });

  it("issues a link to the owner and Admin only", async () => {
    await expect(
      createDownloadLink({ profileId: OWNER.profileId, role: Role.BUYER }, FILE, {}, now),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      createDownloadLink(
        { profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", role: Role.ADMIN },
        FILE,
        {},
        now,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      createDownloadLink(
        { profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", role: Role.AGENT },
        FILE,
        {},
        now,
      ),
    ).resolves.toEqual({ ok: false, status: 404 });
    mockDb.uploadedFile.findUnique.mockResolvedValueOnce(
      available({ status: UploadStatus.QUARANTINED }) as never,
    );
    await expect(
      createDownloadLink({ profileId: OWNER.profileId, role: Role.BUYER }, FILE, {}, now),
    ).resolves.toEqual({ ok: false, status: 404 });
  });

  it("serves the file as an attachment of octet-stream to the same user", async () => {
    const token = await linkFor({ profileId: OWNER.profileId, role: Role.BUYER });
    const result = await readDownload(token, OWNER.profileId, now + 1000);
    expect(result).toMatchObject({
      ok: true,
      disposition: "attachment",
      contentType: "application/octet-stream",
      fileName: "doc.pdf",
    });
  });

  it("allows inline only for previewable images", async () => {
    const pdfToken = await linkFor(
      { profileId: OWNER.profileId, role: Role.BUYER },
      true,
    );
    await expect(readDownload(pdfToken, OWNER.profileId, now)).resolves.toMatchObject({
      disposition: "attachment",
    });
    mockDb.uploadedFile.findUnique.mockResolvedValue(
      available({ previewable: true, detectedType: "image/png" }) as never,
    );
    const imageToken = await linkFor(
      { profileId: OWNER.profileId, role: Role.BUYER },
      true,
    );
    await expect(readDownload(imageToken, OWNER.profileId, now)).resolves.toMatchObject({
      disposition: "inline",
      contentType: "image/png",
    });
  });

  it("refuses expired, tampered, foreign and malformed tokens", async () => {
    const token = await linkFor({ profileId: OWNER.profileId, role: Role.BUYER });
    await expect(
      readDownload(token, OWNER.profileId, now + 6 * 60 * 1000),
    ).resolves.toEqual({
      ok: false,
      status: 403,
    });
    await expect(readDownload(token, "someone-else", now)).resolves.toEqual({
      ok: false,
      status: 403,
    });
    const [body, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString()),
        d: "inline",
      }),
    ).toString("base64url");
    await expect(
      readDownload(`${forged}.${signature}`, OWNER.profileId, now),
    ).resolves.toEqual({
      ok: false,
      status: 403,
    });
    for (const bad of ["", "abc", "a.b.c", "x".repeat(2000)]) {
      await expect(readDownload(bad, OWNER.profileId, now)).resolves.toMatchObject({
        ok: false,
      });
    }
  });
});

describe("upload settings", () => {
  it("validates and audits Admin changes", async () => {
    await expect(
      updateUploadSettings(OWNER, { maxFileMb: "100", userQuotaMb: "2048" }),
    ).resolves.toEqual({ ok: true });
    expect(mockDb.uploadSettings.upsert.mock.calls[0][0]).toMatchObject({
      update: {
        maxFileBytes: 100 * 1024 * 1024,
        userQuotaBytes: BigInt(2048) * BigInt(1024 * 1024),
      },
    });
    for (const bad of [
      { maxFileMb: "0", userQuotaMb: "10" },
      { maxFileMb: "600", userQuotaMb: "1000" },
      { maxFileMb: "100", userQuotaMb: "50" },
      { maxFileMb: "10", userQuotaMb: "10", extra: 1 },
    ]) {
      await expect(updateUploadSettings(OWNER, bad)).resolves.toMatchObject({
        ok: false,
      });
    }
  });
});

describe("ClamdScanner (INSTREAM over TCP)", () => {
  let server: Server;
  let port: number;
  let received: Buffer;

  beforeAll(async () => {
    server = createServer((socket) => {
      const parts: Buffer[] = [];
      socket.on("data", (chunk) => {
        parts.push(chunk);
        const all = Buffer.concat(parts);
        if (all.subarray(-4).equals(Buffer.alloc(4))) {
          received = all;
          const infected = all.includes(Buffer.from("EICAR-STANDARD"));
          socket.end(infected ? "stream: Eicar-Signature FOUND\0" : "stream: OK\0");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("frames the stream and reads clean and infected replies", async () => {
    const scanner = ClamdScanner.fromUrl(`tcp://127.0.0.1:${port}`);
    await expect(scanner.scan(PDF)).resolves.toEqual({ clean: true });
    expect(received.subarray(0, 10).toString()).toBe("zINSTREAM\0");
    expect(received.readUInt32BE(10)).toBe(PDF.length);
    await expect(
      scanner.scan(new TextEncoder().encode(EICAR_TEST_STRING)),
    ).resolves.toEqual({ clean: false, signature: "Eicar-Signature" });
  });

  it("fails closed on connection errors and odd replies", async () => {
    const closed = new ClamdScanner("127.0.0.1", 1, 2000);
    await expect(closed.scan(PDF)).rejects.toBeInstanceOf(MalwareScannerUnavailableError);
    expect(() => ClamdScanner.parseReply("stream: ERROR\0")).toThrow(
      MalwareScannerUnavailableError,
    );
    expect(() => ClamdScanner.fromUrl("http://clamav:3310")).toThrow();
  });
});
