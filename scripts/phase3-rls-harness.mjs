import { PHASE3_ROLES, parsePhase3Fixtures } from "./phase3-fixtures.mjs";

/** Build independently authenticated role clients. No service-role client is accepted. */
export async function authenticateRoleSessions({ fixturesJson, createClient, url, publishableKey }) {
  const fixtures = parsePhase3Fixtures(fixturesJson);
  const sessions = {};
  for (const role of PHASE3_ROLES) {
    const fixture = fixtures[role];
    const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password });
    if (result.error || !result.data?.session?.access_token || result.data.user?.id !== fixture.authUserId) {
      throw new Error(`Fixture authentication or identity verification failed for ${role}`);
    }
    sessions[role] = { client, fixture, userId: result.data.user.id };
  }
  return sessions;
}

export function assertFixtureOwnership(session, identity) {
  if (!session || !identity || session.userId !== identity.authUserId) throw new Error("Fixture ownership mismatch");
  if (identity.legacyUserId !== identity.database?.legacyUserId) throw new Error("Fixture legacy mapping mismatch");
  if (identity.role !== identity.database?.role || identity.active !== identity.database?.active || identity.kycStatus !== identity.database?.kycStatus) {
    throw new Error("Fixture identity consistency mismatch");
  }
}

export async function assertOperation({ client, operation, expected, label }) {
  const result = await operation(client);
  if (result.infrastructureError) throw new Error(`${label}: infrastructure failure`);
  const denied = Boolean(result.error);
  if ((expected === "DENY" && !denied) || (expected === "ALLOW" && denied)) throw new Error(`${label}: unexpected authorization result`);
  return { label, outcome: denied ? "DENIED" : "ALLOWED" };
}

export function buildCleanupPlan(records, ownerIds) {
  if (!Array.isArray(records) || !Array.isArray(ownerIds)) throw new Error("Invalid cleanup inputs");
  return records.filter((record) => ownerIds.includes(record.ownerId)).map((record) => ({ table: record.table, id: record.id, ownerId: record.ownerId }));
}

// Derived from phase3_rls_storage: public application tables default-deny;
// only the following policy families grant authenticated operations.
export const POLICY_MATRIX = Object.freeze([
  { resource: "profiles", role: "owner", select: "ALLOW", update: "ALLOW_SAFE_COLUMNS", crossUser: "DENY" },
  { resource: "User", role: "owner_or_admin", select: "ALLOW", insert: "DENY", update: "DENY" },
  { resource: "Property", role: "anonymous_or_authenticated", select: "ALLOW", insert: "DENY", update: "DENY", delete: "DENY" },
  { resource: "SyndicatePledge", role: "investor", select: "ALLOW", insert: "KYC_REQUIRED", update: "OWNER_STATUS_ONLY", delete: "DENY" },
  { resource: "Enquiry", role: "buyer_or_agent", select: "OWNER_PARTICIPANTS", insert: "ALLOW", update: "STATUS_ONLY", delete: "DENY" },
  { resource: "SavedProperty", role: "buyer", select: "OWNER", insert: "ALLOW", delete: "OWNER" },
  { resource: "Offer", role: "buyer_or_agent", select: "PARTICIPANTS", insert: "BUYER", update: "STATUS_ONLY", delete: "DENY" },
  { resource: "Viewing", role: "buyer_or_agent", select: "PARTICIPANTS", insert: "BUYER", update: "STATUS_ONLY", delete: "DENY" },
  { resource: "ChatMessage", role: "participants", select: "PARTICIPANTS", insert: "PARTICIPANTS", update: "READ_ONLY", delete: "DENY" },
  { resource: "storage.kyc-documents", role: "owner_or_admin", select: "ALLOW", insert: "DENY", update: "DENY", delete: "DENY" },
  { resource: "storage.property-images", role: "owner_or_public-read", select: "ALLOW", insert: "AGENT", update: "OWNER", delete: "OWNER" },
]);

export async function runPolicyMatrix({ sessions, fixtures, operations }) {
  if (!sessions || !fixtures || !operations) throw new Error("RLS matrix dependencies missing");
  const results = [];
  for (const policy of POLICY_MATRIX) {
    const operation = operations[policy.resource];
    if (!operation) results.push({ resource: policy.resource, status: "BLOCKED", reason: "fixture-scoped operation not supplied" });
    else results.push(await operation({ policy, sessions, fixtures }));
  }
  return results;
}

export async function assertProfilePolicy({ sessions, fixtures }) {
  const results = [];
  const ids = Object.values(sessions).map((s) => s.userId);
  for (const [role, session] of Object.entries(sessions)) {
    const own = await session.client.from("profiles").select("id,name,avatarUrl,gdprConsentAt,role,legacyUserId,active,kycStatus").eq("id", session.userId).maybeSingle();
    if (own.error) throw new Error(`profiles own select infrastructure failure for ${role}`);
    if (!own.data || own.data.id !== session.userId) throw new Error(`profiles own record missing for ${role}`);
    results.push({ role, assertion: "own_select", status: "PASS" });
    const cross = await session.client.from("profiles").select("id").in("id", ids.filter((id) => id !== session.userId));
    if (cross.error) throw new Error(`profiles cross-user select infrastructure failure for ${role}`);
    if ((cross.data ?? []).length) throw new Error(`profiles cross-user isolation failed for ${role}`);
    results.push({ role, assertion: "cross_user_select", status: "PASS" });
    const protectedAttempt = await session.client.from("profiles").update({ role: "ADMIN", active: false, kycStatus: "APPROVED", legacyUserId: null }).eq("id", session.userId).select("id");
    if (!protectedAttempt.error && (protectedAttempt.data ?? []).length) throw new Error(`protected profile fields writable for ${role}`);
    results.push({ role, assertion: "protected_columns", status: "PASS" });
  }
  return results;
}

const AREA_TABLES = {
  users: "User", properties: "Property", enquiries: "Enquiry", savedProperties: "SavedProperty",
  offers: "Offer", viewings: "Viewing", pledges: "SyndicatePledge", chat: "ChatMessage",
};

/** Executes fixture-scoped assertions for one policy area. Missing records are BLOCKED, never PASS. */
export async function assertPolicyArea({ area, sessions, fixtures }) {
  const table = AREA_TABLES[area];
  if (!table) throw new Error(`Unknown RLS policy area: ${area}`);
  const descriptor = fixtures.records?.[area];
  if (!descriptor?.id || !descriptor.ownerRole) return { area, status: "BLOCKED", reason: `missing disposable ${table} fixture` };
  const owner = sessions[descriptor.ownerRole];
  if (!owner || descriptor.ownerId !== owner.userId) throw new Error(`${area}: fixture ownership mismatch`);
  const own = await owner.client.from(table).select("*").eq("id", descriptor.id).maybeSingle();
  if (own.error) throw new Error(`${area}: owner read infrastructure failure`);
  if (!own.data) throw new Error(`${area}: expected fixture record missing`);
  const results = [{ area, assertion: "owner_select", status: "PASS" }];
  for (const [role, session] of Object.entries(sessions)) {
    if (role === descriptor.ownerRole) continue;
    const cross = await session.client.from(table).select("id").eq("id", descriptor.id);
    if (cross.error) throw new Error(`${area}: cross-user read infrastructure failure`);
    if ((cross.data ?? []).length) throw new Error(`${area}: cross-user access granted to ${role}`);
    results.push({ area, assertion: `cross_user_${role}`, status: "PASS" });
  }
  return results;
}

export async function assertRemainingPolicyAreas({ sessions, fixtures }) {
  const areas = ["users", "properties", "enquiries", "savedProperties", "offers", "viewings", "pledges", "chat"];
  const output = [];
  for (const area of areas) {
    const result = await assertPolicyArea({ area, sessions, fixtures });
    output.push(...(Array.isArray(result) ? result : [result]));
  }
  for (const bucket of ["kyc-documents", "property-images"]) {
    const descriptor = fixtures.storage?.[bucket];
    if (!descriptor?.path || !descriptor.ownerRole) { output.push({ area: `storage.${bucket}`, status: "BLOCKED", reason: "missing disposable storage fixture" }); continue; }
    const owner = sessions[descriptor.ownerRole];
    if (!owner || descriptor.ownerId !== owner.userId) throw new Error(`storage.${bucket}: fixture ownership mismatch`);
    const read = await owner.client.storage.from(bucket).download(descriptor.path);
    if (read.error) throw new Error(`storage.${bucket}: owner read infrastructure failure`);
    output.push({ area: `storage.${bucket}`, assertion: "owner_read", status: "PASS" });
  }
  return output;
}
