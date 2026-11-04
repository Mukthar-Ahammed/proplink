export const PHASE3_ROLES = ["AGENT", "INVESTOR", "BUYER", "ADMIN"];

export function parsePhase3Fixtures(raw) {
  if (!raw) throw new Error("PHASE3_FIXTURES_JSON is required; refusing legacy identity mutation");
  let fixtures;
  try { fixtures = JSON.parse(raw); } catch { throw new Error("PHASE3_FIXTURES_JSON is invalid"); }
  for (const role of PHASE3_ROLES) {
    const f = fixtures[role];
    if (!f?.email || !f?.password || !f?.authUserId || !f?.legacyUserId) throw new Error(`Incomplete disposable fixture for ${role}`);
    if (!String(f.email).toLowerCase().includes("phase3-test")) throw new Error(`Fixture ${role} is not marked disposable`);
  }
  return fixtures;
}

export function assertIdentityPair(profile, legacy, role) {
  if (!profile || !legacy || profile.legacyUserId !== legacy.id || profile.role !== role || legacy.role !== role || profile.active !== legacy.active || profile.kycStatus !== legacy.kycStatus) throw new Error(`Identity invariant failed for ${role}`);
}
