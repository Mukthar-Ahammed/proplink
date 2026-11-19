import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 7 Task 2: final RLS and authorisation audit at the database, as the
 * client roles PostgREST would use (`anon`, and `authenticated` with a JWT
 * subject), deny-by-default:
 *  - every public table has row-level security on (PostGIS reference data
 *    excepted, documented);
 *  - the client grants are exactly the approved list below — a new grant
 *    fails this test until it is reviewed and added here;
 *  - every other table refuses the client roles outright;
 *  - granted tables expose only what their policies allow.
 * It also replaces the PostgREST-based parity scripts
 * (scripts/phase3-rls-harness.mjs, validate-phase1-investor-type.mjs,
 * validate-phase2-auth.mjs) with local role tests, so the Data API never
 * needs to be switched on to check them. The app itself reaches the
 * database only from the server; the Data API stays off.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await retirePeople(client);
  if (hasDb) await client.end();
});

/**
 * Reviewed client grants: read-only, each backed by a row-level-security
 * policy (Sprint-era public reads, Phase 4 Solicitor reads). Client writes
 * were revoked in Phase 7 (migration 20261121000000, ADR-063).
 */
const APPROVED_GRANTS: Record<string, { anon?: string; authenticated?: string }> = {
  AdSlot: { anon: "SELECT", authenticated: "SELECT" },
  AgentProfile: { anon: "SELECT", authenticated: "SELECT" },
  Appraisal: { authenticated: "SELECT" },
  AuditLog: { authenticated: "SELECT" },
  CaseStudy: { anon: "SELECT", authenticated: "SELECT" },
  ChatMessage: { authenticated: "SELECT" },
  ComparableSale: { anon: "SELECT", authenticated: "SELECT" },
  Deal: { authenticated: "SELECT" },
  Enquiry: { authenticated: "SELECT" },
  LedgerEntry: { authenticated: "SELECT" },
  Milestone: { authenticated: "SELECT" },
  MilestonePhoto: { authenticated: "SELECT" },
  Offer: { authenticated: "SELECT" },
  Partner: { anon: "SELECT", authenticated: "SELECT" },
  Property: { anon: "SELECT", authenticated: "SELECT" },
  PropertyDistressTag: { anon: "SELECT", authenticated: "SELECT" },
  PropertyImage: { anon: "SELECT", authenticated: "SELECT" },
  SavedProperty: { authenticated: "SELECT" },
  SavedSearch: { authenticated: "SELECT" },
  Subscription: { authenticated: "SELECT" },
  SuccessFee: { authenticated: "SELECT" },
  SyndicatePledge: { authenticated: "SELECT" },
  SyndicateProject: { anon: "SELECT", authenticated: "SELECT" },
  Viewing: { authenticated: "SELECT" },
  agreement_parties: { authenticated: "SELECT" },
  distribution_ledger: { authenticated: "SELECT" },
  investor_projects: { authenticated: "SELECT" },
  ledger_corrections: { authenticated: "SELECT" },
  profiles: { authenticated: "SELECT" },
  project_agreements: { authenticated: "SELECT" },
  project_changes: { authenticated: "SELECT" },
  project_costs: { authenticated: "SELECT" },
  project_decisions: { authenticated: "SELECT" },
  project_fund_statuses: { authenticated: "SELECT" },
  project_milestones: { authenticated: "SELECT" },
  project_pledges: { authenticated: "SELECT" },
  project_sales: { authenticated: "SELECT" },
  project_updates: { authenticated: "SELECT" },
};
/** PostGIS catalogue views and reference table (staging exception; production keeps extensions out of public). */
const POSTGIS = new Set(["spatial_ref_sys", "geography_columns", "geometry_columns"]);

async function tables(): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
  );
  return rows.map((r) => r.t as string).filter((t) => !POSTGIS.has(t));
}

/** Runs statements as a client role inside a transaction that is always rolled back. */
async function asRole<T>(
  role: "anon" | "authenticated",
  subject: string | null,
  fn: (
    attempt: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ ok: boolean; code?: string; rows?: Record<string, unknown>[] }>,
  ) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      subject ?? "",
    ]);
    let n = 0;
    return await fn(async (sql, params = []) => {
      const savepoint = `s${n++}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return { ok: true, rows: result.rows };
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        return { ok: false, code: (error as { code?: string }).code };
      }
    });
  } finally {
    await client.query("ROLLBACK");
  }
}

describe.skipIf(!hasDb)("RLS and authorisation audit (Phase 7 Task 2)", () => {
  it("has row-level security on every public table", async () => {
    const { rows } = await client.query(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`,
    );
    expect(rows.map((r) => r.t).filter((t) => !POSTGIS.has(t))).toEqual([]);
  });

  it("grants the client roles exactly the approved privileges", async () => {
    const { rows } = await client.query(
      `SELECT table_name AS t, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
       GROUP BY 1, 2`,
    );
    const actual: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      if (POSTGIS.has(row.t)) continue;
      expect(row.grantee, `${row.t}: PUBLIC grant`).not.toBe("PUBLIC");
      (actual[row.t] ??= {})[row.grantee] = row.p;
    }
    expect(actual).toEqual(APPROVED_GRANTS);
  });

  it("has no column-level client grants left", async () => {
    const { rows } = await client.query(
      `SELECT DISTINCT cp.table_name AS t, cp.grantee, cp.privilege_type AS p
       FROM information_schema.column_privileges cp
       WHERE cp.table_schema = 'public' AND cp.grantee IN ('anon', 'authenticated')
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.role_table_grants tg
           WHERE tg.table_schema = 'public' AND tg.table_name = cp.table_name
             AND tg.grantee = cp.grantee AND tg.privilege_type = cp.privilege_type
         )`,
    );
    expect(rows.filter((r) => !POSTGIS.has(r.t))).toEqual([]);
  });

  it("refuses the anonymous role everywhere it has no grant, and never lets it write", async () => {
    const all = await tables();
    const problems = await asRole("anon", null, async (attempt) => {
      const found: string[] = [];
      for (const t of all) {
        const read = await attempt(`SELECT 1 FROM public."${t}" LIMIT 1`);
        const granted = APPROVED_GRANTS[t]?.anon?.includes("SELECT");
        if (!granted && (read.ok || read.code !== "42501"))
          found.push(`${t}: read not refused`);
        const write = await attempt(`DELETE FROM public."${t}" WHERE false`);
        if (write.ok || write.code !== "42501") found.push(`${t}: delete not refused`);
        const insert = await attempt(`INSERT INTO public."${t}" DEFAULT VALUES`);
        if (insert.ok || insert.code !== "42501") found.push(`${t}: insert not refused`);
      }
      return found;
    });
    expect(problems).toEqual([]);
  });

  it("refuses a signed-in client everywhere it has no grant", async () => {
    const buyer = await person(client, "BUYER");
    const all = await tables();
    const { rows: firstColumns } = await client.query(
      `SELECT DISTINCT ON (table_name) table_name AS t, column_name AS c
       FROM information_schema.columns WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
    );
    const firstColumn = new Map(firstColumns.map((r) => [r.t as string, r.c as string]));
    const problems = await asRole("authenticated", buyer.profileId, async (attempt) => {
      const found: string[] = [];
      for (const t of all) {
        const granted = APPROVED_GRANTS[t]?.authenticated ?? "";
        const read = await attempt(`SELECT 1 FROM public."${t}" LIMIT 1`);
        if (!granted.includes("SELECT") && (read.ok || read.code !== "42501")) {
          found.push(`${t}: read not refused`);
        }
        const insert = await attempt(`INSERT INTO public."${t}" DEFAULT VALUES`);
        if (insert.ok || insert.code !== "42501")
          found.push(`${t}: insert not refused (${insert.code})`);
        const column = firstColumn.get(t);
        const update = await attempt(
          `UPDATE public."${t}" SET "${column}" = "${column}" WHERE false`,
        );
        if (update.ok || update.code !== "42501")
          found.push(`${t}: update not refused (${update.code})`);
        const remove = await attempt(`DELETE FROM public."${t}" WHERE false`);
        if (remove.ok || remove.code !== "42501")
          found.push(`${t}: delete not refused (${remove.code})`);
      }
      return found;
    });
    expect(problems).toEqual([]);
  });

  it("shows anonymous visitors public listings only", async () => {
    const hidden = await asRole("anon", null, async (attempt) => {
      const result = await attempt(
        `SELECT count(*)::int AS n FROM public."Property" WHERE status NOT IN ('LIVE', 'UNDER_OFFER', 'SOLD')`,
      );
      return result.rows?.[0]?.n;
    });
    expect(hidden).toBe(0);
  });

  // ── Parity with the retired PostgREST scripts ────────────────────────────

  it("lets a member read only their own profile, and change none of it", async () => {
    const buyer = await person(client, "BUYER");
    const other = await person(client, "INVESTOR");
    const result = await asRole("authenticated", buyer.profileId, async (attempt) => ({
      own: (
        await attempt(`SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [
          buyer.profileId,
        ])
      ).rows?.[0]?.n,
      others: (
        await attempt(`SELECT count(*)::int AS n FROM public.profiles WHERE id <> $1`, [
          buyer.profileId,
        ])
      ).rows?.[0]?.n,
      cross: (
        await attempt(`SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [
          other.profileId,
        ])
      ).rows?.[0]?.n,
      role: (
        await attempt(`UPDATE public.profiles SET role = 'ADMIN' WHERE id = $1`, [
          buyer.profileId,
        ])
      ).code,
      kyc: (
        await attempt(
          `UPDATE public.profiles SET "kycStatus" = 'APPROVED' WHERE id = $1`,
          [buyer.profileId],
        )
      ).code,
      type: (
        await attempt(
          `UPDATE public.profiles SET "investorType" = 'SYNDICATE' WHERE id = $1`,
          [buyer.profileId],
        )
      ).code,
      legacy: (
        await attempt(`UPDATE public."User" SET role = 'ADMIN' WHERE id = $1`, [
          buyer.legacyUserId,
        ])
      ).code,
    }));
    expect(result).toEqual({
      own: 1,
      others: 0,
      cross: 0,
      role: "42501",
      kyc: "42501",
      type: "42501",
      legacy: "42501",
    });
  });

  it("hides project and ledger rows from members who are not on the project", async () => {
    const buyer: Person = await person(client, "BUYER");
    const counts = await asRole("authenticated", buyer.profileId, async (attempt) => {
      const out: Record<string, unknown> = {};
      for (const t of [
        "investor_projects",
        "project_pledges",
        "project_agreements",
        "agreement_parties",
        "distribution_ledger",
        "ledger_corrections",
        "project_sales",
      ]) {
        out[t] = (await attempt(`SELECT count(*)::int AS n FROM public."${t}"`)).rows?.[0]
          ?.n;
      }
      return out;
    });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it("does not let a member write saved listings directly (only the server does)", async () => {
    const buyer = await person(client, "BUYER");
    const other = await person(client, "BUYER");
    const { rows } = await client.query(
      `SELECT id FROM public."Property" WHERE status = 'LIVE' LIMIT 1`,
    );
    if (rows.length === 0) return;
    const code = await asRole(
      "authenticated",
      buyer.profileId,
      async (attempt) =>
        (
          await attempt(
            `INSERT INTO public."SavedProperty" ("userId", "propertyId") VALUES ($1, $2)`,
            [other.legacyUserId, rows[0].id],
          )
        ).code,
    );
    expect(code).toBe("42501");
  });
});
