import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));

import {
  recordSecurityEvent,
  securityEventSummary,
} from "@/services/security/securityEvents";

/**
 * Phase 6 Task 4 (migration 20261120030000, ADR-061): security events are
 * per-minute counts, so repeated events add to one row instead of one row
 * each; the summary totals them.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await client.end();
});

describe.skipIf(!hasDb)("security events (Task 4)", () => {
  it("aggregates per minute and summarises", async () => {
    // A minute far in the future, so other test runs do not mix in.
    const when = new Date("2099-01-01T10:15:30Z");
    await client.query(
      `DELETE FROM public.security_event_counts WHERE bucket = '2099-01-01T10:15:00'`,
    );
    for (let i = 0; i < 5; i += 1) await recordSecurityEvent("LOGIN_FAILED", when);
    await recordSecurityEvent("WEBHOOK_REJECTED", when);
    const { rows } = await client.query(
      `SELECT kind::text, count FROM public.security_event_counts WHERE bucket = '2099-01-01T10:15:00' ORDER BY kind`,
    );
    expect(rows).toEqual([
      { kind: "LOGIN_FAILED", count: 5 },
      { kind: "WEBHOOK_REJECTED", count: 1 },
    ]);
    const summary = await securityEventSummary(new Date("2099-01-01T11:00:00Z"));
    expect(summary.find((s) => s.kind === "LOGIN_FAILED")).toMatchObject({ lastDay: 5 });
    expect(summary.find((s) => s.kind === "LOGIN_FAILED")?.hourly.at(-1)).toBe(5);
    await client.query(
      `DELETE FROM public.security_event_counts WHERE bucket = '2099-01-01T10:15:00'`,
    );
  });

  it("never throws, even for an impossible event", async () => {
    await expect(
      recordSecurityEvent("NOT_A_KIND" as never, new Date()),
    ).resolves.toBeUndefined();
  });
});
