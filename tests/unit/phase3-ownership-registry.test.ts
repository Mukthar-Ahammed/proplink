import { describe, expect, it, vi } from "vitest";
import { createOwnershipRegistryAdapter } from "../../scripts/phase3-ownership-registry.mjs";

function makeClient(rows: Record<string, unknown>[] = []) {
  const calls: string[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push(`${sql} ${JSON.stringify(values ?? [])}`);
      return { rows };
    }),
    connect: async () => undefined,
    end: async () => {},
  };
}

describe("phase3 ownership registry", () => {
  it("writes planned intent through parameterized SQL", async () => {
    const client = makeClient();
    const adapter = createOwnershipRegistryAdapter({ clientFactory: () => client });

    await adapter.recordPlanned(client, {
      projectRef: "staging",
      runId: "r",
      resourceType: "Property",
      resourceKey: { id: "p" },
      resourceId: "p",
      ownerAuthUserId: "a",
      ownerLegacyUserId: "u",
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO private.phase3_fixture_resources"),
      expect.any(Array),
    );
    expect(client.calls[0]).toContain("INSERT INTO private.phase3_fixture_resources");
  });

  it("requires verified registry and business-row agreement", async () => {
    const client = makeClient([
      { state: "VERIFIED", run_id: "r", owner_legacy_user_id: "u" },
    ]);
    const adapter = createOwnershipRegistryAdapter({ clientFactory: () => client });

    await expect(
      adapter.reconcile(
        {
          projectRef: "staging",
          runId: "r",
          resourceType: "Property",
          resourceId: "p",
          ownerLegacyUserId: "u",
        },
        async () => true,
      ),
    ).resolves.toEqual({ status: "VERIFIED" });
  });

  it("rejects cleanup when registry or business verification fails", async () => {
    const client = makeClient();
    const adapter = createOwnershipRegistryAdapter({ clientFactory: () => client });

    await expect(
      adapter.authorizeCleanup(
        {
          projectRef: "staging",
          runId: "r",
          resourceType: "Property",
          resourceId: "p",
          ownerLegacyUserId: "u",
        },
        async () => true,
      ),
    ).rejects.toThrow(/rejected/);
  });
});
