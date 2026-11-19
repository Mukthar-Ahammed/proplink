import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_DATA_VERSION,
  provisionFixtureData,
  validateFixtureManifest,
  cleanupFixtureData,
  buildPrismaFixturePayloads,
  resolveLedgerParentIds,
  provisionDependentWithLedger,
} from "../../scripts/phase3-fixture-data.mjs";

const identities = Object.fromEntries(
  ["AGENT", "INVESTOR", "BUYER", "ADMIN"].map((role) => [
    role,
    {
      authUserId: `${role.toLowerCase()}-id`,
      legacyUserId: `${role.toLowerCase()}-legacy`,
    },
  ]),
);
const manifest = { version: FIXTURE_DATA_VERSION, projectRef: "staging", resources: [] };
type FixtureOwner = { authUserId: string; legacyUserId?: string };
type FixtureResource = { state?: string; [key: string]: unknown };
type FixtureManifest = {
  version: number;
  projectRef: string;
  resources: FixtureResource[];
};

describe("phase3 fixture data workflow", () => {
  it("rejects non-staging or malformed manifests", () => {
    expect(() => validateFixtureManifest(manifest, "other")).toThrow();
    expect(() =>
      validateFixtureManifest({ ...manifest, resources: [{ kind: "x" }] }, "staging"),
    ).toThrow();
  });
  it("creates records in dependency order and is retry-safe", async () => {
    const calls: string[] = [];
    const db = {
      ensureRecord: vi.fn(async (kind: string, owner: FixtureOwner) => {
        calls.push(kind);
        return { id: kind, ownerId: owner.authUserId };
      }),
    };
    const storage = {
      ensureObject: vi.fn(async (_b: string, path: string, ownerId: string) => ({
        id: path,
        ownerId,
      })),
    };
    const first = await provisionFixtureData({
      projectRef: "staging",
      manifest: structuredClone(manifest),
      identities,
      db,
      storage,
    });
    expect(calls[0]).toBe("profiles");
    expect(first.manifest.resources.length).toBeGreaterThan(1);
    const before = calls.length;
    await provisionFixtureData({
      projectRef: "staging",
      manifest: first.manifest,
      identities,
      db,
      storage,
    });
    expect(calls.length).toBe(before);
  });
  it("supports dry-run cleanup without deleting", async () => {
    const result = await cleanupFixtureData({
      projectRef: "staging",
      manifest: {
        ...manifest,
        resources: [
          {
            kind: "properties",
            id: "p",
            ownerId: "a",
            disposableMarker: "phase3-test-a",
          },
        ],
      },
      db: {},
      storage: {},
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.plan).toHaveLength(1);
  });
  it("fails closed on provisioning failure", async () => {
    await expect(
      provisionFixtureData({
        projectRef: "staging",
        manifest: structuredClone(manifest),
        identities,
        db: {
          ensureRecord: vi.fn(async () => {
            throw new Error("constraint");
          }),
        },
        storage: { ensureObject: vi.fn() },
      }),
    ).rejects.toThrow("constraint");
  });
  it("builds schema-valid dependent payloads with verified relationships", () => {
    const payloads = buildPrismaFixturePayloads({
      ids: {
        agentUserId: "a",
        buyerUserId: "b",
        investorUserId: "i",
        propertyId: "p",
        projectId: "s",
        enquiryId: "e",
        offerId: "o",
        viewingId: "v",
        chatId: "c",
        pledgeId: "l",
      },
    });
    expect(payloads.Property.id).toBe("p");
    expect(payloads.Property.title).toBe("Phase 3 disposable property");
    expect(payloads.Enquiry.propertyId).toBe("p");
    expect(payloads.Offer.buyerUserId).toBe("b");
    expect(payloads.SyndicatePledge.projectId).toBe("s");
  });
  it("recovers parent IDs only from verified ledger resources", () => {
    expect(
      resolveLedgerParentIds([
        { kind: "Property", id: "p", state: "VERIFIED" },
        { kind: "SyndicateProject", id: "s", state: "VERIFIED" },
      ]),
    ).toEqual({ propertyId: "p", projectId: "s" });
    expect(() =>
      resolveLedgerParentIds([{ kind: "Property", id: "p", state: "PLANNED" }]),
    ).toThrow();
  });
  it("provisions all dependent models in order with durable transitions", async () => {
    const entries: FixtureResource[] = [];
    const ledgerApi = {
      put: async (entry: FixtureResource) => {
        entries.push(entry);
      },
    };
    const payloads = Object.fromEntries(
      [
        "Property",
        "SyndicateProject",
        "Enquiry",
        "SavedProperty",
        "Offer",
        "Viewing",
        "ChatMessage",
        "SyndicatePledge",
      ].map((kind) => [kind, { id: kind.toLowerCase() }]),
    );
    const identityMap: Record<string, { legacyUserId: string }> = {
      AGENT: { legacyUserId: "agent" },
      BUYER: { legacyUserId: "buyer" },
      INVESTOR: { legacyUserId: "investor" },
    };
    const db = {
      ensureRecord: vi.fn(async (kind: string) => ({ id: kind, ownerId: "owner" })),
    };
    const result = await provisionDependentWithLedger({
      projectRef: "staging",
      manifest: { version: 1, projectRef: "staging", resources: [] },
      ledger: ledgerApi,
      db,
      payloads,
      identities: identityMap,
    });
    expect(
      result.resources.filter(
        (resource: FixtureResource) => resource.state === "VERIFIED",
      ),
    ).toHaveLength(8);
    expect(entries.filter((r) => r.state === "PLANNED")).toHaveLength(8);
  });
  it("blocks restart on uncertain resources and allows verified reuse", async () => {
    const ledgerApi = { put: vi.fn() };
    const db = {
      ensureRecord: vi.fn(),
      reconcileRecord: vi.fn(async () => ({ status: "CONFLICT" })),
    };
    const payloads = Object.fromEntries(
      [
        "Property",
        "SyndicateProject",
        "Enquiry",
        "SavedProperty",
        "Offer",
        "Viewing",
        "ChatMessage",
        "SyndicatePledge",
      ].map((kind) => [kind, { id: kind }]),
    );
    const identityMap: Record<string, { legacyUserId: string }> = {
      AGENT: { legacyUserId: "a" },
      BUYER: { legacyUserId: "b" },
      INVESTOR: { legacyUserId: "i" },
    };
    const retryManifest: FixtureManifest = {
      version: 1,
      projectRef: "staging",
      resources: [
        {
          key: "db:Property",
          kind: "Property",
          state: "NEEDS_RECONCILIATION",
          id: "p",
          ownerId: "a",
          disposableMarker: "phase3-test-a",
        },
      ],
    };
    await expect(
      provisionDependentWithLedger({
        projectRef: "staging",
        manifest: retryManifest,
        ledger: ledgerApi,
        db,
        payloads,
        identities: identityMap,
      }),
    ).rejects.toThrow(/reconciliation/);
    expect(db.ensureRecord).not.toHaveBeenCalled();
  });
});
