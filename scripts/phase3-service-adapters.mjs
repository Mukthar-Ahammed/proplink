import { createClient } from "@supabase/supabase-js";
import pg from "pg";

export class AuthCreationUncertainError extends Error {
  constructor(cause) { super("Supabase Auth creation outcome is uncertain", { cause }); this.name = "AuthCreationUncertainError"; this.uncertain = true; this.code = "AUTH_CREATE_UNCERTAIN"; }
}

export function createAuthAdapter(env, adminClient) {
  const ref = env.PROPLINK_STAGING_PROJECT_REF;
  if (!ref || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co` || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Invalid staging Auth configuration");
  const admin = adminClient ?? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const verify = (u, marker, email) => u?.email === email && u?.app_metadata?.proplink_fixture_marker === marker && u?.app_metadata?.phase3_disposable === true;
  return {
    async createUser(input) {
      if (!input.email.startsWith("phase3-test-")) throw new Error("Non-disposable Auth identity");
      let result;
      try { result = await admin.auth.admin.createUser(input); } catch (error) { throw new AuthCreationUncertainError(error); }
      if (result.error) throw new AuthCreationUncertainError(result.error);
      if (!result.data?.user || !verify(result.data.user, input.app_metadata.proplink_fixture_marker, input.email)) throw new AuthCreationUncertainError(new Error("Incomplete Auth response"));
      return { id: result.data.user.id, email: result.data.user.email };
    },
    async getUser(id) { const { data, error } = await admin.auth.admin.getUserById(id); if (error || !data.user || !data.user.email?.startsWith("phase3-test-")) throw error ?? new Error("Auth discovery failed"); return { id: data.user.id, email: data.user.email }; },
    async discover(marker, email) { const matches=[]; const perPage=100; for(let page=1;page<=20;page++){const {data,error}=await admin.auth.admin.listUsers({page,perPage}); if(error) throw new AuthCreationUncertainError(error); for(const u of data.users??[]) if(u.app_metadata?.proplink_fixture_marker===marker) matches.push(u); if((data.users??[]).length<perPage){if(matches.some((u)=>!verify(u,marker,email))) throw new Error("Conflicting Auth identity"); return matches;}} throw new Error("Auth discovery incomplete; reconciliation required"); }
  };
}

export function createDatabaseAdapter(env, helper) { const make=()=>new pg.Client({connectionString:env.DIRECT_URL,ssl:{rejectUnauthorized:false}}); return { async provision(input){const client=make();await client.connect();try{return await helper({transaction:async(fn)=>{await client.query("BEGIN");let result;try{result=await fn({query:(s,v)=>client.query(s,v)});}catch(e){await client.query("ROLLBACK");throw e;}try{await client.query("COMMIT");}catch(e){const x=new Error("Database commit outcome uncertain",{cause:e});x.uncertain=true;x.code="DB_COMMIT_UNCERTAIN";throw x;}return result;}},input);}finally{await client.end();}}, async verify(authId,legacyId,role){const c=make();await c.connect();try{const r=await c.query(`SELECT p.role::text AS role,p.active,p."kycStatus"::text AS kyc,u.role::text AS user_role,u.active AS user_active,u."kycStatus"::text AS user_kyc FROM public.profiles p JOIN public."User" u ON u.id=p."legacyUserId" WHERE p.id=$1::uuid AND u.id=$2 AND p.role=$3::public."Role"`,[authId,legacyId,role]);return r.rows.length===1&&r.rows[0].role===r.rows[0].user_role&&r.rows[0].active===r.rows[0].user_active&&r.rows[0].kyc===r.rows[0].user_kyc;}finally{await c.end();}}}; }

export function createFixtureDatabaseAdapter(env, payloads, clientFactory, registryOptions = {}) {
  const make = () => clientFactory ? clientFactory() : new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
  const tables = { Property: 'public."Property"', SyndicateProject: 'public."SyndicateProject"', Enquiry: 'public."Enquiry"', SavedProperty: 'public."SavedProperty"', Offer: 'public."Offer"', Viewing: 'public."Viewing"', ChatMessage: 'public."ChatMessage"', SyndicatePledge: 'public."SyndicatePledge"' };
  return { async ensureRecord(kind, expected, parentRefs = {}) {
    const payload = payloads[kind]; if (!payload || !tables[kind]) throw new Error(`Unsupported fixture model: ${kind}`);
    const client = make(); await client.connect();
    try { await client.query("BEGIN");
      const id = payload.id ?? payload.userId;
      const existing = await client.query(`SELECT * FROM ${tables[kind]} WHERE ${payload.id ? "id" : '"userId"'}=$1 LIMIT 1`, [id]);
      if (existing.rows[0]) { const row = existing.rows[0]; for (const [key, value] of Object.entries(payload)) if (value instanceof Date ? new Date(row[key]).getTime() !== value.getTime() : row[key] !== value) throw new Error(`Conflicting fixture record: ${kind}`); await client.query("COMMIT"); return { id, ownerId: expected.legacyUserId, reused: true }; }
      const keys = Object.keys(payload); const values = keys.map((key) => payload[key]); const columns = keys.map((key) => `"${key}"`).join(","); const params = values.map((_, i) => `$${i + 1}`).join(",");
      await client.query(`INSERT INTO ${tables[kind]} (${columns}) VALUES (${params})`, values);
      if (registryOptions.runId) {
        if (registryOptions.projectRef !== env.PROPLINK_STAGING_PROJECT_REF || !registryOptions.ownerAuthUserId) throw new Error("Invalid fixture registry binding");
        const resourceKey = kind === "SavedProperty" ? JSON.stringify({ userId: payload.userId, propertyId: payload.propertyId }) : JSON.stringify({ id });
        await client.query(`INSERT INTO private.phase3_fixture_resources (project_ref,run_id,resource_type,resource_key,resource_id,owner_auth_user_id,owner_legacy_user_id,parent_refs,state,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'VERIFIED',now())`, [registryOptions.projectRef, registryOptions.runId, kind, resourceKey, String(id), registryOptions.ownerAuthUserId, expected.legacyUserId, parentRefs ?? {}]);
      }
      try { await client.query("COMMIT"); } catch (cause) { const uncertain = new Error("Database fixture commit outcome uncertain", { cause }); uncertain.uncertain = true; uncertain.code = "DB_COMMIT_UNCERTAIN"; throw uncertain; } return { id, ownerId: expected.legacyUserId, reused: false };
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} if (error?.code === "DB_COMMIT_UNCERTAIN") throw error; throw error; } finally { await client.end(); }
  }, async reconcileRecord(kind, expected, ledgerEntry) {
    const payload = payloads[kind]; if (!payload || !ledgerEntry?.id) return { status: "INCOMPLETE", reason: "missing payload or ledger id" };
    const client = make(); await client.connect();
    try {
      const key = payload.id ? "id" : '"userId"'; const row = await client.query(`SELECT * FROM ${tables[kind]} WHERE ${key}=$1`, [ledgerEntry.id]);
      if (!row.rows.length) return { status: "MISSING" };
      const record = row.rows[0];
      for (const [field, value] of Object.entries(payload)) {
        if (value instanceof Date) { if (new Date(record[field]).getTime() !== value.getTime()) return { status: "CONFLICT", reason: `field ${field}` }; }
        else if (record[field] !== value) return { status: "CONFLICT", reason: `field ${field}` };
      }
      if (ledgerEntry.ownerId !== expected.legacyUserId) return { status: "CONFLICT", reason: "owner mismatch" };
      return { status: "VERIFIED", id: ledgerEntry.id };
    } finally { await client.end(); }
  } };
}
