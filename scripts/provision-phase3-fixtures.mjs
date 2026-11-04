import fs from "node:fs";
import dotenv from "dotenv";
import { createAuthAdapter, createDatabaseAdapter } from "./phase3-service-adapters.mjs";
import { provisionLegacyIdentity } from "./provision-db-helper.mjs";
import { provisionOne } from "./provision-coordinator.mjs";
import { readLedger, writeLedger } from "./phase3-ledger.mjs";
import { buildPrismaFixturePayloads, provisionDependentWithLedger } from "./phase3-fixture-data.mjs";

export async function runPhase3Provisioning(options = {}) {
  const env = options.env ?? dotenv.parse(fs.readFileSync(options.envFile ?? ".env.staging.local"));
  const ref = env.PROPLINK_STAGING_PROJECT_REF;
  if (!ref || ref === "onhdlxxbdcfwujhtphaj" || !env.NEXT_PUBLIC_SUPABASE_URL?.includes(ref)) throw new Error("Staging project rejected");
  if (env.CONFIRM_PHASE3_PROVISION !== "yes") throw new Error("Set CONFIRM_PHASE3_PROVISION=yes to authorize provisioning");
  if (!env.PHASE3_FIXTURES_JSON) throw new Error("PHASE3_FIXTURES_JSON is required");
  let fixtures; try { fixtures = JSON.parse(env.PHASE3_FIXTURES_JSON); } catch { throw new Error("Invalid fixture configuration"); }
  const file = options.ledgerFile ?? ".phase3-fixtures-ledger.json";
  let ledgerData;
  try { ledgerData = options.ledgerData ?? (options.ledgerReader ? options.ledgerReader(file) : readLedger(file)); } catch (error) { throw new Error("Fixture ledger could not be read", { cause: error }); }
  if (ledgerData.resources.some((r) => r.projectRef && r.projectRef !== ref)) throw new Error("Ledger project binding mismatch");
  const persist = async (entry) => { const i = ledgerData.resources.findIndex((r) => (r.key && r.key === entry.key) || (r.role && r.role === entry.role)); if (i < 0) ledgerData.resources.push(entry); else ledgerData.resources[i] = entry; if (options.ledgerWriter) await options.ledgerWriter(ledgerData, file); else writeLedger(ledgerData, file); };
  const ledger = { get: async (role) => ledgerData.resources.find((r) => r.role === role), put: persist };
  const auth = options.auth ?? createAuthAdapter(env);
  const database = options.database ?? createDatabaseAdapter(env, provisionLegacyIdentity);
  for (const role of ["AGENT", "INVESTOR", "BUYER", "ADMIN"]) await provisionOne({ fixture: { ...fixtures[role], role }, auth, database, ledger, projectRef: ref });
  if (options.dependents && options.database?.ensureRecord) {
    if (!options.registry?.runId) throw new Error("Registry configuration is required for dependent fixture creation");
    const identities = Object.fromEntries(["AGENT", "INVESTOR", "BUYER", "ADMIN"].map((role) => { const e = ledgerData.resources.find((r) => r.role === role && r.state === "READY"); if (!e) throw new Error(`Verified identity missing for ${role}`); return [role, { legacyUserId: e.legacyUserId, authUserId: e.authUserId }]; }));
    const parent = ledgerData.resources.find((r) => r.key === "db:Property" && r.state === "VERIFIED");
    const project = ledgerData.resources.find((r) => r.key === "db:SyndicateProject" && r.state === "VERIFIED");
    for (const parentEntry of ledgerData.resources.filter((r) => ["db:Property", "db:SyndicateProject"].includes(r.key))) if (parentEntry.state !== "VERIFIED") throw new Error("Parent fixture requires reconciliation before child provisioning");
    const ids = { agentUserId: identities.AGENT.legacyUserId, buyerUserId: identities.BUYER.legacyUserId, investorUserId: identities.INVESTOR.legacyUserId, propertyId: parent?.id ?? "phase3-test-property", projectId: project?.id ?? "phase3-test-project", enquiryId: "phase3-test-enquiry", offerId: "phase3-test-offer", viewingId: "phase3-test-viewing", chatId: "phase3-test-chat", pledgeId: "phase3-test-pledge" };
    const payloads = buildPrismaFixturePayloads({ ids });
    await provisionDependentWithLedger({ projectRef: ref, manifest: { version: 1, projectRef: ref, resources: ledgerData.resources.filter((r) => r.key?.startsWith("db:")) }, ledger, db: options.database, payloads, identities });
  }
  return { env: { projectRef: ref }, ledger: ledgerData };
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname.toLowerCase().endsWith(process.argv[1].replaceAll("\\", "/").toLowerCase());
if (isMain) runPhase3Provisioning().catch((error) => { console.error(error instanceof Error ? error.message : "Provisioning failed"); process.exitCode = 1; });
