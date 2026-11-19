import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Private object storage for the secure upload pipeline (ADR-031). Two areas:
 * `quarantine` (unscanned) and `private` (scanned, clean). Nothing here is
 * public; downloads go through the app's signed download route.
 */

export type StoreArea = "quarantine" | "private";

export interface ObjectStore {
  readonly name: "memory" | "local" | "s3" | "database";
  put(
    area: StoreArea,
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  get(area: StoreArea, key: string): Promise<Uint8Array>;
  delete(area: StoreArea, key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z]+\/[0-9a-f-]{36}$/;

function assertKey(key: string) {
  // Keys are always server-generated `<prefix>/<uuid>`: no traversal possible.
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
}

/** Tests only. */
export class MemoryObjectStore implements ObjectStore {
  readonly name = "memory" as const;
  readonly objects = new Map<string, Uint8Array>();

  async put(area: StoreArea, key: string, bytes: Uint8Array) {
    assertKey(key);
    this.objects.set(`${area}:${key}`, new Uint8Array(bytes));
  }

  async get(area: StoreArea, key: string) {
    assertKey(key);
    const value = this.objects.get(`${area}:${key}`);
    if (!value) throw new Error("Object not found");
    return value;
  }

  async delete(area: StoreArea, key: string) {
    assertKey(key);
    this.objects.delete(`${area}:${key}`);
  }
}

/** Local development: files under `.data/uploads/<area>/` (git-ignored). */
export class LocalDiskObjectStore implements ObjectStore {
  readonly name = "local" as const;

  constructor(private readonly root = path.join(process.cwd(), ".data", "uploads")) {}

  private file(area: StoreArea, key: string) {
    assertKey(key);
    return path.join(this.root, area, key);
  }

  async put(area: StoreArea, key: string, bytes: Uint8Array) {
    const target = this.file(area, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(area: StoreArea, key: string) {
    return new Uint8Array(await readFile(this.file(area, key)));
  }

  async delete(area: StoreArea, key: string) {
    await rm(this.file(area, key), { force: true });
  }
}

/** Two private S3 buckets; credentials from the default AWS chain. */
export class S3ObjectStore implements ObjectStore {
  readonly name = "s3" as const;
  private readonly client: S3Client;

  constructor(
    private readonly buckets: Record<StoreArea, string>,
    region: string,
  ) {
    this.client = new S3Client({ region });
  }

  async put(area: StoreArea, key: string, bytes: Uint8Array, contentType: string) {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[area],
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async get(area: StoreArea, key: string) {
    assertKey(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.buckets[area], Key: key }),
    );
    if (!result.Body) throw new Error("Object not found");
    return new Uint8Array(await result.Body.transformToByteArray());
  }

  async delete(area: StoreArea, key: string) {
    assertKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.buckets[area], Key: key }),
    );
  }
}
