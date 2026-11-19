import { describe, expect, it, vi } from "vitest";
import {
  assertFixtureOwnership,
  assertOperation,
  buildCleanupPlan,
  authenticateRoleSessions,
  POLICY_MATRIX,
  runPolicyMatrix,
  assertProfilePolicy,
  assertPolicyArea,
  assertRemainingPolicyAreas,
} from "../../scripts/phase3-rls-harness.mjs";

const roles = ["AGENT", "INVESTOR", "BUYER", "ADMIN"];
const fixtures = Object.fromEntries(
  roles.map((role, i) => [
    role,
    {
      email: `phase3-test-${role.toLowerCase()}@example.invalid`,
      password: "secret",
      authUserId: `id-${i}`,
      legacyUserId: `legacy-${i}`,
    },
  ]),
);
type TestSession = { userId: string; client: object };
type PolicyResult = { resource: string; status: string };

describe("phase3 independent RLS harness", () => {
  it("authenticates every role independently and preserves JWT isolation", async () => {
    const clients: { auth: { signInWithPassword: () => Promise<unknown> } }[] = [];
    const createClient = vi.fn(() => {
      const index = clients.length;
      const client = {
        auth: {
          signInWithPassword: vi.fn(async () => ({
            data: { session: { access_token: "jwt" }, user: { id: `id-${index}` } },
            error: null,
          })),
        },
      };
      clients.push(client);
      return client;
    });
    const sessions = await authenticateRoleSessions({
      fixturesJson: JSON.stringify(fixtures),
      createClient,
      url: "https://staging.supabase.co",
      publishableKey: "anon",
    });
    expect(Object.keys(sessions)).toEqual(roles);
    expect(
      new Set(
        Object.values(sessions).map((session: { userId: string }) => session.userId),
      ).size,
    ).toBe(4);
  });

  it("rejects identity mismatch and missing fixtures", async () => {
    expect(() => assertFixtureOwnership({ userId: "x" }, { authUserId: "y" })).toThrow();
    await expect(
      authenticateRoleSessions({
        fixturesJson: JSON.stringify({}),
        createClient: vi.fn(),
        url: "https://staging.supabase.co",
        publishableKey: "anon",
      }),
    ).rejects.toThrow();
  });

  it("distinguishes expected denial from infrastructure failure", async () => {
    await expect(
      assertOperation({
        client: {},
        expected: "DENY",
        label: "private",
        operation: async () => ({ error: { code: "42501" } }),
      }),
    ).resolves.toMatchObject({ outcome: "DENIED" });
    await expect(
      assertOperation({
        client: {},
        expected: "DENY",
        label: "network",
        operation: async () => ({ infrastructureError: true }),
      }),
    ).rejects.toThrow(/infrastructure/);
  });

  it("only plans cleanup for explicitly owned records", () => {
    expect(
      buildCleanupPlan(
        [
          { table: "x", id: 1, ownerId: "a" },
          { table: "x", id: 2, ownerId: "other" },
        ],
        ["a"],
      ),
    ).toEqual([{ table: "x", id: 1, ownerId: "a" }]);
  });

  it("executes supplied policy assertions and blocks missing fixture operations", async () => {
    const results = await runPolicyMatrix({
      sessions: {},
      fixtures: {},
      operations: {
        profiles: async ({ policy }: { policy: { resource: string } }) => ({
          resource: policy.resource,
          status: "PASS",
        }),
      },
    });
    const typedResults = results as PolicyResult[];
    expect(typedResults.find((result) => result.resource === "profiles")?.status).toBe(
      "PASS",
    );
    expect(typedResults.filter((result) => result.status === "BLOCKED").length).toBe(
      POLICY_MATRIX.length - 1,
    );
  });

  it("rejects unexpected authorization outcomes", async () => {
    await expect(
      assertOperation({
        client: {},
        expected: "DENY",
        label: "cross-user",
        operation: async () => ({ data: [{ id: "other" }] }),
      }),
    ).rejects.toThrow();
  });

  it("executes profile ownership and protected-column assertions", async () => {
    const profile = (id: string) => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { id }, error: null })),
          })),
          in: vi.fn(async () => ({ data: [], error: null })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({ data: [], error: { code: "42501" } })),
          })),
        })),
      })),
    });
    const sessions: Record<string, TestSession> = {
      AGENT: { userId: "a", client: profile("a") },
      INVESTOR: { userId: "b", client: profile("b") },
      BUYER: { userId: "c", client: profile("c") },
      ADMIN: { userId: "d", client: profile("d") },
    };
    const result = await assertProfilePolicy({ sessions });
    expect(result).toHaveLength(12);
  });

  it("blocks policy areas without disposable records", async () => {
    const result = await assertRemainingPolicyAreas({ sessions: {}, fixtures: {} });
    expect(result.every((entry: { status: string }) => entry.status === "BLOCKED")).toBe(
      true,
    );
  });

  it("executes owner and cross-user assertions for a disposable property", async () => {
    const make = (rows: { id: string }[]) => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: rows[0], error: null })),
          })),
          in: vi.fn(async () => ({ data: rows, error: null })),
        })),
      })),
    });
    const sessions: Record<string, TestSession> = {
      AGENT: { userId: "a", client: make([{ id: "p" }]) },
      BUYER: { userId: "b", client: make([]) },
    };
    const result = await assertPolicyArea({
      area: "properties",
      sessions,
      fixtures: {
        records: { properties: { id: "p", ownerRole: "AGENT", ownerId: "a" } },
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([
        { area: "properties", assertion: "owner_select", status: "PASS" },
      ]),
    );
  });
});
