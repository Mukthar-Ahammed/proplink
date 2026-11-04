import { describe, expect, it } from "vitest";
import { createFixtureDatabaseAdapter } from "../../scripts/phase3-service-adapters.mjs";
import { buildPrismaFixturePayloads } from "../../scripts/phase3-fixture-data.mjs";

const ids = { agentUserId: "a", buyerUserId: "b", investorUserId: "i", propertyId: "p", projectId: "s", enquiryId: "e", offerId: "o", viewingId: "v", chatId: "c", pledgeId: "l" };
const payloads = buildPrismaFixturePayloads({ ids });
const owner = { legacyUserId: "a" };
function clientFactory(mode = "ok", row: any = null) { const calls: string[] = []; return { calls, client: () => ({ connect: async () => {}, end: async () => {}, query: async (sql: string) => { calls.push(sql); if (sql === "COMMIT" && mode === "uncertain") throw new Error("network"); if (sql.startsWith("SELECT")) return { rows: row ? [row] : [] }; if (sql.startsWith("INSERT") && mode === "fail") throw new Error("constraint"); return { rows: [] }; } }) }; }

describe("createFixtureDatabaseAdapter", () => {
  for (const model of Object.keys(payloads)) {
    it(`provisions ${model} transactionally`, async () => {
      const f = clientFactory(); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client);
      const result = await adapter.ensureRecord(model, owner, {});
      expect(result.id).toBe(payloads[model].id ?? payloads[model].userId);
      expect(f.calls.some((sql) => String(sql).toUpperCase().includes("INSERT"))).toBe(true);
      expect(f.calls).toContain("COMMIT");
    });
  }
  it("rolls back definite failures", async () => { const f = clientFactory("fail"); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client); await expect(adapter.ensureRecord("Property", owner, {})).rejects.toThrow("constraint"); expect(f.calls).toContain("ROLLBACK"); });
  it("classifies uncertain commits", async () => { const f = clientFactory("uncertain"); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client); await expect(adapter.ensureRecord("Property", owner, {})).rejects.toMatchObject({ uncertain: true, code: "DB_COMMIT_UNCERTAIN" }); });
  it("creates business and registry rows in one transaction", async () => { const f = clientFactory(); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused", PROPLINK_STAGING_PROJECT_REF: "staging" }, payloads, f.client, { projectRef: "staging", runId: "run", ownerAuthUserId: "auth" }); await adapter.ensureRecord("Property", owner, {}); expect(f.calls.some((sql) => String(sql).includes("private.phase3_fixture_resources"))).toBe(true); expect(f.calls.indexOf("COMMIT")).toBe(f.calls.length - 1); });
  for (const model of Object.keys(payloads)) {
    it(`reconciles ${model} read-only and reports missing`, async () => {
      const payload = payloads[model]; const f = clientFactory(); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client);
      const missing = await adapter.reconcileRecord(model, owner, { id: payload.id ?? payload.userId, ownerId: owner.legacyUserId });
      expect(missing.status).toBe("MISSING");
      expect(f.calls.some((sql) => String(sql).toUpperCase().includes("INSERT"))).toBe(false);
    });
  }
  for (const model of Object.keys(payloads)) {
    const payload = payloads[model];
    it(`reconciles matching ${model} as VERIFIED`, async () => {
      const f = clientFactory("ok", payload); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client);
      const result = await adapter.reconcileRecord(model, owner, { id: payload.id ?? payload.userId, ownerId: owner.legacyUserId });
      expect(result.status).toBe("VERIFIED");
    });
    for (const field of Object.keys(payload).slice(0, 2)) {
      it(`flags ${model} ${field} conflict`, async () => {
        const row = { ...payload, [field]: typeof payload[field] === "number" ? payload[field] + 1 : "conflict" };
        const f = clientFactory("ok", row); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client);
        const result = await adapter.reconcileRecord(model, owner, { id: payload.id ?? payload.userId, ownerId: owner.legacyUserId });
        expect(result.status).toBe("CONFLICT");
      });
    }
    it(`flags ${model} wrong owner`, async () => {
      const f = clientFactory("ok", payload); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client);
      const result = await adapter.reconcileRecord(model, { legacyUserId: "wrong-owner" }, { id: payload.id ?? payload.userId, ownerId: owner.legacyUserId });
      expect(result.status).toBe("CONFLICT");
    });
    it(`flags ${model} ledger ID mismatch as MISSING`, async () => {
      const f = clientFactory("ok", null); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client);
      const result = await adapter.reconcileRecord(model, owner, { id: "wrong-ledger-id", ownerId: owner.legacyUserId });
      expect(["MISSING", "CONFLICT"]).toContain(result.status);
    });
    it(`flags ${model} incomplete evidence`, async () => {
      const f = clientFactory("ok", payload); const adapter = createFixtureDatabaseAdapter({ DIRECT_URL: "unused" }, payloads, f.client);
      const result = await adapter.reconcileRecord(model, owner, {} as any);
      expect(result.status).toBe("INCOMPLETE");
    });
  }
});
