import "server-only";

import { db } from "@/lib/db";
import type { ObjectStore, StoreArea } from "@/services/uploads/objectStore";

const KEY_PATTERN = /^[a-z]+\/[0-9a-f-]{36}$/;

function assertKey(key: string) {
  // Keys are always server-generated `<prefix>/<uuid>` (the table checks it too).
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
}

/**
 * Hosted demo only (ADR-076): uploaded files kept in Postgres, because the
 * demo has no S3 and serverless functions share no disk. The pipeline's size
 * limits still apply. Never used in production or staging.
 */
export class DatabaseObjectStore implements ObjectStore {
  readonly name = "database" as const;

  async put(area: StoreArea, key: string, bytes: Uint8Array, contentType: string) {
    assertKey(key);
    const data = new Uint8Array(bytes);
    await db.demoStoredObject.upsert({
      where: { area_key: { area, key } },
      create: { area, key, bytes: data, contentType },
      update: { bytes: data, contentType },
    });
  }

  async get(area: StoreArea, key: string) {
    assertKey(key);
    const row = await db.demoStoredObject.findUnique({
      where: { area_key: { area, key } },
      select: { bytes: true },
    });
    if (!row) throw new Error("Object not found");
    return new Uint8Array(row.bytes);
  }

  async delete(area: StoreArea, key: string) {
    assertKey(key);
    await db.demoStoredObject.deleteMany({ where: { area, key } });
  }
}
