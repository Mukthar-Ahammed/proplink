import { describe, expect, it } from "vitest";
import { assertIdentityPair, parsePhase3Fixtures } from "../../scripts/phase3-fixtures.mjs";

const fixture = (role: string) => ({ email: `phase3-test-${role.toLowerCase()}@example.test`, password: "disposable", authUserId: `${role}-auth`, legacyUserId: `${role}-legacy` });
const all = Object.fromEntries(["AGENT", "INVESTOR", "BUYER", "ADMIN"].map((r) => [r, fixture(r)]));

describe("Phase 3 disposable identity fixtures", () => {
  it("requires all marked disposable fixtures", () => expect(parsePhase3Fixtures(JSON.stringify(all))).toEqual(all));
  it("rejects missing fixtures", () => expect(() => parsePhase3Fixtures(JSON.stringify({ AGENT: fixture("AGENT") }))).toThrow(/Incomplete/));
  it("rejects unmarked identities", () => expect(() => parsePhase3Fixtures(JSON.stringify({ ...all, ADMIN: { ...all.ADMIN, email: "real@example.test" } }))).toThrow(/disposable/));
  it("enforces the mapped identity invariant", () => { expect(() => assertIdentityPair({ legacyUserId: "x", role: "ADMIN", active: true, kycStatus: "NOT_STARTED" }, { id: "x", role: "ADMIN", active: true, kycStatus: "NOT_STARTED" }, "ADMIN")).not.toThrow(); expect(() => assertIdentityPair({ legacyUserId: "x", role: "ADMIN", active: true, kycStatus: "NOT_STARTED" }, { id: "x", role: "BUYER", active: true, kycStatus: "NOT_STARTED" }, "ADMIN")).toThrow(/invariant/); });
});
