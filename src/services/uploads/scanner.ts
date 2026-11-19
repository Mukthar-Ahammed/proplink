import { connect } from "node:net";

/**
 * Malware scanning (Phase 1 Task 12, ADR-031). Every upload is scanned before
 * it leaves quarantine. Any scanner error fails closed.
 */

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface MalwareScanProvider {
  readonly name: "mock" | "clamav";
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

export class MalwareScannerUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Malware scanner unavailable: ${reason}`);
    this.name = "MalwareScannerUnavailableError";
  }
}

/** The standard anti-malware test file (harmless; every scanner detects it). */
export const EICAR_TEST_STRING =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** Local/test scanner: flags the EICAR test string anywhere in the file. */
export class MockMalwareScanner implements MalwareScanProvider {
  readonly name = "mock" as const;

  async scan(bytes: Uint8Array): Promise<ScanResult> {
    return Buffer.from(bytes).includes(EICAR_TEST_STRING)
      ? { clean: false, signature: "Eicar-Test-Signature" }
      : { clean: true };
  }
}

const CHUNK_BYTES = 64 * 1024;

/**
 * clamd over TCP using its INSTREAM command: `zINSTREAM\0`, then chunks of
 * `<uint32 big-endian length><bytes>`, then a zero-length chunk. Replies are
 * `stream: OK` or `stream: <signature> FOUND`. clamd's StreamMaxLength must be
 * at least the upload size limit.
 */
export class ClamdScanner implements MalwareScanProvider {
  readonly name = "clamav" as const;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  static fromUrl(url: string): ClamdScanner {
    const parsed = new URL(url);
    if (parsed.protocol !== "tcp:") {
      throw new Error("MALWARE_SCANNER_URL must be tcp://host:port for clamd");
    }
    return new ClamdScanner(parsed.hostname, Number(parsed.port || 3310));
  }

  scan(bytes: Uint8Array): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const replies: Buffer[] = [];
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new MalwareScannerUnavailableError(reason));
      };
      socket.setTimeout(this.timeoutMs, () => fail("timeout"));
      socket.on("error", () => fail("connection"));
      socket.on("data", (chunk) => replies.push(chunk));
      socket.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(ClamdScanner.parseReply(Buffer.concat(replies).toString("utf8")));
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    }).catch((error: unknown) => {
      if (error instanceof MalwareScannerUnavailableError) throw error;
      throw new MalwareScannerUnavailableError(
        error instanceof Error ? error.message : "unknown",
      );
    }) as Promise<ScanResult>;
  }

  /** Exposed for tests. Anything other than a clear OK/FOUND is an error. */
  static parseReply(reply: string): ScanResult {
    const text = reply.replace(/\0/g, "").trim();
    if (/^stream: OK$/.test(text)) return { clean: true };
    const found = /^stream: (.+) FOUND$/.exec(text);
    if (found) return { clean: false, signature: found[1].slice(0, 200) };
    throw new MalwareScannerUnavailableError(`unexpected reply: ${text.slice(0, 100)}`);
  }
}
