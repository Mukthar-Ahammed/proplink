import fs from "node:fs";
import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createAuthAdapter } from "./phase3-service-adapters.mjs";
import { readLedger } from "./phase3-ledger.mjs";

export function classify(expected, auth, row) {
  if (!auth) return "MISSING";
  if (!row) return "INCOMPLETE";
  if (auth.id !== row.id || auth.email !== expected.email || row.email !== expected.email || row.marker !== expected.marker || row.role !== expected.role || row.userRole !== expected.role || row.active !== row.userActive || row.kycStatus !== row.userKyc) return "CONFLICT";
  return "VERIFIED";
}
if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const env=dotenv.parse(fs.readFileSync(".env.staging.local")); const guard=spawnSync(process.execPath,["scripts/assert-staging-db.mjs"],{env:{...process.env,...env},stdio:"inherit",shell:false}); if(guard.status!==0) process.exit(guard.status??1);
  const ledger=readLedger(); const auth=createAuthAdapter(env); const db=new pg.Client({connectionString:env.DIRECT_URL,ssl:{rejectUnauthorized:false}}); await db.connect(); const results=[];
  try { for(const e of ledger.resources){const u=await auth.getUser(e.authUserId).catch(()=>null); const r=e.legacyUserId?(await db.query(`SELECT p.id,p."legacyUserId",p.role::text AS role,p.email,u.role::text AS "userRole",p.active,u.active AS "userActive",p."kycStatus"::text AS "kycStatus",u."kycStatus"::text AS "userKyc" FROM public.profiles p JOIN public."User" u ON u.id=p."legacyUserId" WHERE p.id=$1::uuid AND u.id=$2`,[e.authUserId,e.legacyUserId])).rows[0]:null; results.push({role:e.role,status:classify({email:e.email,marker:e.marker,role:e.role},u,r)});} console.log(JSON.stringify({mode:"read-only",results},null,2)); if(results.some(x=>x.status!=="VERIFIED")) process.exitCode=1; } finally {await db.end();}
}
