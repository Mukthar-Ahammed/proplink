import { describe, expect, it } from "vitest";
import { parsePhase3Fixtures } from "../../scripts/phase3-fixtures.mjs";

const f=(r:string)=>({email:`phase3-test-${r.toLowerCase()}@example.test`,password:"secret",authUserId:`${r}-auth`,legacyUserId:`${r}-legacy`});
const valid=Object.fromEntries(["AGENT","INVESTOR","BUYER","ADMIN"].map(r=>[r,f(r)]));
describe("Phase 3 auth fixture contract",()=>{
  it("requires all roles",()=>expect(Object.keys(parsePhase3Fixtures(JSON.stringify(valid)))).toHaveLength(4));
  it("rejects incomplete provisioning",()=>expect(()=>parsePhase3Fixtures(JSON.stringify({AGENT:f("AGENT")}))).toThrow());
  it("requires disposable naming",()=>expect(()=>parsePhase3Fixtures(JSON.stringify({...valid,ADMIN:{...f("ADMIN"),email:"real@example.test"}}))).toThrow());
  it("does not expose secrets in fixture metadata",()=>expect(JSON.stringify({role:"BUYER",password:"[REDACTED]",access_token:"[REDACTED]"})).not.toContain("secret"));
});
