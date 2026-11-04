import { createClient } from "@supabase/supabase-js";
import { PHASE3_ROLES, parsePhase3Fixtures } from "./phase3-fixtures.mjs";

export async function authenticateFixtures(raw, url, key) {
  const fixtures = parsePhase3Fixtures(raw);
  const sessions = {};
  for (const role of PHASE3_ROLES) {
    const f = fixtures[role];
    const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const { data, error } = await client.auth.signInWithPassword({ email: f.email, password: f.password });
    if (error || !data.session || data.user?.id !== f.authUserId) throw new Error(`Fixture authentication failed for ${role}`);
    sessions[role] = { client, userId: data.user.id };
  }
  return sessions;
}

export function redactFixtureReport(report) { return JSON.parse(JSON.stringify(report, (key, value) => /password|token|access_token|refresh_token/i.test(key) ? "[REDACTED]" : value)); }
