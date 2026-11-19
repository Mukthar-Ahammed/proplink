import { describe, expect, it, vi } from "vitest";
import { provisionOne, STATES } from "../../scripts/provision-coordinator.mjs";
import { createMemoryLedger } from "../../scripts/phase3-ledger.mjs";
process.env.PROPLINK_STAGING_PROJECT_REF = "stage";
const fixture = {
  role: "AGENT",
  email: "phase3-test-agent@example.test",
  password: "secret",
  name: "Agent",
};
function deps() {
  return {
    auth: {
      createUser: vi.fn().mockResolvedValue({ id: "auth-1" }),
      getUser: vi.fn().mockResolvedValue({ email: fixture.email }),
      discover: vi.fn().mockResolvedValue([]),
    },
    database: {
      provision: vi.fn().mockResolvedValue({ legacyUserId: "legacy-1" }),
      verify: vi.fn().mockResolvedValue(true),
    },
    ledger: createMemoryLedger(),
    projectRef: "stage",
  };
}
describe("provision coordinator", () => {
  it("provisions to READY", async () => {
    const d = deps();
    expect((await provisionOne({ fixture, ...d })).state).toBe(STATES.READY);
  });
  it("records auth failure", async () => {
    const d = deps();
    d.auth.createUser.mockRejectedValue(new Error("auth failed"));
    await expect(provisionOne({ fixture, ...d })).rejects.toThrow();
    expect((await d.ledger.get("AGENT")).state).toBe(STATES.FAILED);
  });
  it("marks auth-only crash for reconciliation", async () => {
    const d = deps();
    d.ledger.put = vi.fn().mockRejectedValueOnce(new Error("ledger crash"));
    await expect(provisionOne({ fixture, ...d })).rejects.toThrow();
  });
  it("is idempotent when READY", async () => {
    const d = deps();
    await d.ledger.put({
      role: "AGENT",
      email: fixture.email,
      projectRef: "stage",
      state: STATES.READY,
    });
    await provisionOne({ fixture, ...d });
    expect(d.auth.createUser).not.toHaveBeenCalled();
  });
  it("rejects production ownership", async () => {
    const d = deps();
    await expect(
      provisionOne({ fixture, ...d, projectRef: "onhdlxxbdcfwujhtphaj" }),
    ).rejects.toThrow();
  });
  it("recovers a discovered Auth identity", async () => {
    const d = deps();
    d.auth.discover = vi
      .fn()
      .mockResolvedValue([{ id: "auth-existing", email: fixture.email }]);
    await provisionOne({ fixture, ...d });
    expect(d.auth.createUser).not.toHaveBeenCalled();
  });
  it("rejects ambiguous discovery", async () => {
    const d = deps();
    d.auth.discover = vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(provisionOne({ fixture, ...d })).rejects.toThrow(/Ambiguous/);
  });
  it("marks uncertain Auth failure for reconciliation", async () => {
    const d = deps();
    const error = Object.assign(new Error("timeout"), { uncertain: true });
    d.auth.createUser = vi.fn().mockRejectedValue(error);
    await expect(provisionOne({ fixture, ...d })).rejects.toThrow();
    expect((await d.ledger.get("AGENT")).state).toBe(STATES.NEEDS_RECONCILIATION);
  });
});
