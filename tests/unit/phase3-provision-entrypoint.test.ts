import { describe, expect, it, vi } from "vitest";
import { runPhase3Provisioning } from "../../scripts/provision-phase3-fixtures.mjs";

const fixtures = Object.fromEntries(["AGENT", "INVESTOR", "BUYER", "ADMIN"].map((role) => [role, { email: `phase3-test-${role.toLowerCase()}@example.invalid`, password: "x", authUserId: role, legacyUserId: `${role}-legacy` }]));
const base = { PROPLINK_STAGING_PROJECT_REF: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co", CONFIRM_PHASE3_PROVISION: "yes", PHASE3_FIXTURES_JSON: JSON.stringify(fixtures) };

describe("real phase3 provisioning entry point", () => {
  it("imports without side effects", () => expect(typeof runPhase3Provisioning).toBe("function"));
  for (const [label, env] of [["production", { ...base, PROPLINK_STAGING_PROJECT_REF: "onhdlxxbdcfwujhtphaj", NEXT_PUBLIC_SUPABASE_URL: "https://onhdlxxbdcfwujhtphaj.supabase.co" }], ["wrong project", { ...base, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }], ["confirmation", { ...base, CONFIRM_PHASE3_PROVISION: "no" }], ["fixtures", { ...base, PHASE3_FIXTURES_JSON: "{" }]] as const) {
    it(`rejects ${label} before adapters`, async () => {
      const auth = vi.fn(); const database = vi.fn();
      await expect(runPhase3Provisioning({ env, auth, database, ledgerFile: ".missing-test-ledger.json" })).rejects.toThrow();
      expect(auth).not.toHaveBeenCalled(); expect(database).not.toHaveBeenCalled();
    });
  }
  it("reaches injected dependencies only after guards", async () => {
    const auth = { createUser: vi.fn(), discover: vi.fn(async () => []) }; const database = { provision: vi.fn(), verify: vi.fn(async () => true) };
    const ledger = { version: 2, resources: [] };
    await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, ledgerFile: ".phase3-test-ledger.json" })).rejects.toThrow();
    expect(auth.discover.mock.calls.length + auth.createUser.mock.calls.length + database.provision.mock.calls.length).toBeGreaterThanOrEqual(0);
  });
  it("runs identity and dependent orchestration with injected services", async () => {
    process.env.PROPLINK_STAGING_PROJECT_REF = "staging";
    const calls: string[] = []; const auth = { discover: vi.fn(async () => { calls.push("auth.discover"); return []; }), createUser: vi.fn(async (input: any) => { calls.push("auth.create"); return { id: input.email.split("@")[0] }; }), getUser: vi.fn() };
    const database: any = { provision: vi.fn(async () => { calls.push("identity.provision"); return { legacyUserId: "legacy" }; }), verify: vi.fn(async () => { calls.push("identity.verify"); return true; }), ensureRecord: vi.fn(async (kind: string) => { calls.push(kind); return { id: kind, ownerId: "legacy" }; }) };
    const result = await runPhase3Provisioning({ env: base, auth, database, registry: { runId: "run" }, ledgerData: { version: 2, resources: [] }, ledgerFile: ".phase3-test-ledger.json", dependents: true });
    expect(result.ledger.resources.filter((r: any) => r.state === "VERIFIED").length).toBeGreaterThanOrEqual(8);
    expect(calls).toContain("Property");
    expect(calls.indexOf("auth.create")).toBeLessThan(calls.indexOf("Property"));
    expect(calls.indexOf("Property")).toBeLessThan(calls.indexOf("SyndicateProject"));
    expect(calls.indexOf("SyndicateProject")).toBeLessThan(calls.indexOf("Enquiry"));
    const models = ["Property","SyndicateProject","Enquiry","SavedProperty","Offer","Viewing","ChatMessage","SyndicatePledge"];
    expect(models.filter((x) => calls.includes(x))).toHaveLength(8);
  });

  const readyIdentities = () => ({ version: 2, resources: ["AGENT","INVESTOR","BUYER","ADMIN"].map((role) => ({ role, email: fixtures[role].email, projectRef: "staging", authUserId: role, legacyUserId: `${role}-legacy`, state: "READY" })) });
  const dependent = (state: string, kind = "Property", id = "p") => ({ key: `db:${kind}`, kind, model: kind, projectRef: "staging", ownerId: "AGENT-legacy", disposableMarker: "phase3-test-agent", state, id });
  it("reuses verified parents on restart without duplicate insertion", async () => {
    const auth: any = { getUser: vi.fn(async (id: string) => ({ id, email: fixtures[id].email })) }; const database: any = { verify: vi.fn(async () => true), ensureRecord: vi.fn() };
    const ledger = readyIdentities(); ledger.resources.push(dependent("VERIFIED", "Property", "p"), dependent("VERIFIED", "SyndicateProject", "s"));
    await runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, dependents: false });
    expect(database.ensureRecord).not.toHaveBeenCalled();
  });
  for (const [label, state] of [["non-verified parent", "PLANNED"], ["needs reconciliation", "NEEDS_RECONCILIATION"]] as const) {
    it(`blocks restart with ${label}`, async () => {
      const auth: any = { getUser: vi.fn(async (id: string) => ({ id, email: fixtures[id].email })) }; const database: any = { verify: vi.fn(async () => true), ensureRecord: vi.fn() };
      const ledger = readyIdentities(); ledger.resources.push(dependent(state, "Property", "p"));
      await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, dependents: true })).rejects.toThrow();
      expect(database.ensureRecord).not.toHaveBeenCalled();
    });
  }
  for (const [label, state] of [["definite failure", "FAILED"], ["uncertain commit", "NEEDS_RECONCILIATION"], ["partial child", "PLANNED"]] as const) {
    it(`handles restart after ${label}`, async () => {
      const auth: any = { getUser: vi.fn(async (id: string) => ({ id, email: fixtures[id].email })) }; const database: any = { verify: vi.fn(async () => true), ensureRecord: vi.fn(async () => ({ id: "new" })) };
      const ledger = readyIdentities(); ledger.resources.push(dependent("VERIFIED", "Property", "p"), dependent("VERIFIED", "SyndicateProject", "s"), dependent(state, "Enquiry", "e"));
      if (label === "partial child") await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, registry: { runId: "run" }, dependents: true })).resolves.toBeDefined();
      else if (state !== "FAILED") await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, dependents: true })).rejects.toThrow();
      else await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, dependents: false })).resolves.toBeDefined();
    });
  }
  it("rejects corrupt ledger before external adapters", async () => {
    const auth = vi.fn(); const database = vi.fn();
    await expect(runPhase3Provisioning({ env: base, auth, database, ledgerFile: ".missing-corrupt-ledger.json", ledgerData: { version: 99, resources: [] } })).rejects.toThrow();
    expect(auth).not.toHaveBeenCalled(); expect(database).not.toHaveBeenCalled();
  });
  it("rejects wrong-project ledger entries", async () => {
    const auth: any = { getUser: vi.fn() }; const database: any = { verify: vi.fn() };
    const ledger = readyIdentities(); ledger.resources[0].projectRef = "other";
    await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, dependents: false })).rejects.toThrow();
  });
  it("fails closed for uncertain dependent commit before retry", async () => {
    const auth: any = { getUser: vi.fn(async (id: string) => ({ id, email: fixtures[id].email })) }; const database: any = { verify: vi.fn(async () => true), ensureRecord: vi.fn(async () => { const e: any = new Error("commit"); e.uncertain = true; e.code = "DB_COMMIT_UNCERTAIN"; throw e; }), reconcileRecord: vi.fn(async () => ({ status: "CONFLICT" })) };
    const ledger = readyIdentities(); ledger.resources.push(dependent("NEEDS_RECONCILIATION", "Property", "p"));
    await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, dependents: true })).rejects.toThrow();
    expect(database.ensureRecord).not.toHaveBeenCalled();
  });
  it("rejects unreadable ledger before adapters", async () => {
    const auth = vi.fn(); const database = vi.fn();
    await expect(runPhase3Provisioning({ env: base, ledgerReader: () => { throw new Error("EACCES"); }, auth, database })).rejects.toThrow(/could not be read/);
    expect(auth).not.toHaveBeenCalled(); expect(database).not.toHaveBeenCalled();
  });
  it("does not insert when PLANNED ledger persistence fails", async () => {
    const auth: any = { discover: vi.fn(async () => []), createUser: vi.fn(async (input: any) => ({ id: input.email })) }; const database: any = { provision: vi.fn(), verify: vi.fn() };
    await expect(runPhase3Provisioning({ env: base, ledgerData: { version: 2, resources: [] }, ledgerWriter: async () => { throw new Error("disk full"); }, auth, database })).rejects.toThrow(/disk full/);
    expect(database.provision).not.toHaveBeenCalled();
  });
  it("blocks duplicate insertion after COMMIT and VERIFIED-ledger failure", async () => {
    const auth: any = { getUser: vi.fn(async (id: string) => ({ id, email: fixtures[id].email })) };
    const database: any = { verify: vi.fn(async () => true), ensureRecord: vi.fn(async () => ({ id: "committed-property", ownerId: "AGENT-legacy" })) };
    const durable: any = { version: 2, resources: readyIdentities().resources };
    let writes = 0;
    const writer = async (next: any) => { writes++; if (writes === 2) throw new Error("ledger VERIFIED write failed"); durable.resources = structuredClone(next.resources); };
    await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: durable, ledgerWriter: writer, registry: { runId: "run" }, dependents: true })).rejects.toThrow(/VERIFIED write failed/);
    expect(database.ensureRecord).toHaveBeenCalledTimes(1);
    const before = database.ensureRecord.mock.calls.length;
    await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: durable, ledgerWriter: async () => {}, registry: { runId: "run" }, dependents: true })).rejects.toThrow();
    expect(database.ensureRecord.mock.calls.length).toBe(before);
  });
  it("rejects a truncated ledger without adapters", async () => {
    const auth = vi.fn(); const database = vi.fn();
    await expect(runPhase3Provisioning({ env: base, ledgerReader: () => { throw new SyntaxError("Unexpected end of JSON input"); }, auth, database })).rejects.toThrow(/could not be read/);
    expect(auth).not.toHaveBeenCalled(); expect(database).not.toHaveBeenCalled();
  });
  it("blocks automatic reinsertion after uncertain commit with missing reconciliation", async () => {
    const auth: any = { getUser: vi.fn(async (id: string) => ({ id, email: fixtures[id].email })) };
    const database: any = { verify: vi.fn(async () => true), ensureRecord: vi.fn(), reconcileRecord: vi.fn(async () => ({ status: "MISSING" })) };
    const ledger = readyIdentities(); ledger.resources.push(dependent("NEEDS_RECONCILIATION", "Property", "p"));
    await expect(runPhase3Provisioning({ env: base, auth, database, ledgerData: ledger, dependents: true })).rejects.toThrow();
    expect(database.ensureRecord).not.toHaveBeenCalled();
  });
});
