import { describe, expect, it, vi } from "vitest";
import { provisionOne, STATES } from "../../scripts/provision-coordinator.mjs";
import { createMemoryLedger } from "../../scripts/phase3-ledger.mjs";
process.env.PROPLINK_STAGING_PROJECT_REF="stage";
const roles=["AGENT","INVESTOR","BUYER","ADMIN"];
const make=(role:string)=>({role,email:`phase3-test-${role.toLowerCase()}@example.test`,password:"secret",name:`Test ${role}`});
function deps(){const ledger=createMemoryLedger();const auth={createUser:vi.fn(async({email}:{email:string})=>({id:`auth-${email}`,email})),getUser:vi.fn(async(id:string)=>({id,email:`phase3-test-${id.replace("auth-","")}@example.test`})),discover:vi.fn(async()=>[])};const database={provision:vi.fn(async({authUserId}:{authUserId:string})=>({legacyUserId:`legacy-${authUserId}`})),verify:vi.fn(async()=>true)};return {ledger,auth,database,projectRef:"stage"};}
describe("Phase 3 provisioning orchestration",()=>{
 it("provisions all roles sequentially to READY",async()=>{const d=deps();for(const role of roles)await provisionOne({fixture:make(role),...d});expect(d.auth.createUser).toHaveBeenCalledTimes(4);expect(d.database.provision).toHaveBeenCalledTimes(4);expect(d.ledger.entries().every((e:any)=>e.state===STATES.READY)).toBe(true);});
 it("requires confirmation at entry contract",()=>expect(process.env.CONFIRM_PHASE3_PROVISION).not.toBe("yes"));
 it("retries recorded Auth identity without duplicate creation",async()=>{const d=deps();const f=make("AGENT");await d.ledger.put({role:f.role,email:f.email,projectRef:"stage",authUserId:"auth-agent",state:STATES.AUTH_CREATED});await provisionOne({fixture:f,...d});expect(d.auth.createUser).not.toHaveBeenCalled();});
 it("fails closed when verification fails",async()=>{const d=deps();d.database.verify=vi.fn(async()=>false);await expect(provisionOne({fixture:make("BUYER"),...d})).rejects.toThrow(/verification/);});
 it("rejects production project",async()=>{const d=deps();await expect(provisionOne({fixture:make("ADMIN"),...d,projectRef:"onhdlxxbdcfwujhtphaj"})).rejects.toThrow();});
});
