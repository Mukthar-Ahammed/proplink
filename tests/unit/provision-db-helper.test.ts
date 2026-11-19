import { describe, expect, it, vi } from "vitest";
import { provisionLegacyIdentity } from "../../scripts/provision-db-helper.mjs";

type QueryResult = { rows: Record<string, unknown>[] };
type Query = (sql: string, values?: unknown[]) => Promise<QueryResult>;
type Transaction = { query: Query };
type Database = {
  transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
};

function db(): {
  tx: Transaction;
  database: Database;
  query: ReturnType<typeof vi.fn<Query>>;
} {
  const query = vi
    .fn<Query>()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "a", legacyUserId: null }] })
    .mockResolvedValue({ rows: [] });
  const tx = { query };
  const database = {
    transaction: async <T>(callback: (transaction: Transaction) => Promise<T>) =>
      callback(tx),
  };
  return { tx, database, query };
}

describe("database fixture provisioning", () => {
  it("creates User and maps trigger-created profile", async () => {
    const { database } = db();
    const result = await provisionLegacyIdentity(database, {
      authUserId: "00000000-0000-0000-0000-000000000001",
      email: "phase3-test-agent@example.test",
      name: "Test Agent",
      role: "AGENT",
    });
    expect(result.role).toBe("AGENT");
  });

  it("rolls back on constraint failure", async () => {
    const { database, query } = db();
    query.mockRejectedValueOnce(new Error("23505"));
    await expect(
      provisionLegacyIdentity(database, {
        authUserId: "x",
        email: "phase3-test-agent@example.test",
        name: "x",
        role: "AGENT",
      }),
    ).rejects.toThrow("23505");
  });

  it("rejects duplicate identity", async () => {
    const { database, query } = db();
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [{ id: "existing" }] });
    await expect(
      provisionLegacyIdentity(database, {
        authUserId: "x",
        email: "phase3-test-agent@example.test",
        name: "x",
        role: "AGENT",
      }),
    ).rejects.toThrow("already exists");
  });
});
