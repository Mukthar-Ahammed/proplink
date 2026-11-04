import { describe, expect, it } from "vitest";
import { validateHistory } from "../../scripts/checkpoint-history.mjs";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";

const root = path.resolve(process.cwd());
const names = ["20260709000000_init", "20260801190000_property_pricing_safeguard", "20260801200000_property_moderation_fields", "20260807120000_property_view_count", "20261006000000_supabase_auth_profiles"];
const rows = names.map((migration_name) => ({ migration_name, checksum: "", finished_at: new Date(), rolled_back_at: null }));
for (const row of rows) row.checksum = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "prisma/migrations", row.migration_name, "migration.sql"))).digest("hex");

describe("staging checkpoint migration history", () => {
  it("accepts five active migrations plus a rolled-back attempt", () => expect(validateHistory([...rows, { migration_name: "20261007000000_phase3_rls_storage", checksum: "old", finished_at: null, rolled_back_at: new Date() }], names.concat("20261007000000_phase3_rls_storage"), root, 5)).toHaveLength(5));
  it("rejects unresolved failures", () => expect(() => validateHistory([{ ...rows[0], finished_at: null, rolled_back_at: null }], names, root, 1)).toThrow(/unresolved/));
  it("rejects duplicate active migrations", () => expect(() => validateHistory([rows[0], rows[0]], names, root, 2)).toThrow(/order|Duplicate/));
  it("rejects checksum mismatch", () => expect(() => validateHistory([{ ...rows[0], checksum: "bad" }], names, root, 1)).toThrow(/Checksum/));
});
