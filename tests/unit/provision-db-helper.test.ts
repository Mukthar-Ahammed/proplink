import { describe, expect, it, vi } from "vitest";
import { provisionLegacyIdentity } from "../../scripts/provision-db-helper.mjs";
function db(rows:any[]=[]){const tx={query:vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:"a",legacyUserId:null}]}).mockResolvedValue({rows:[]})}; return {tx,transaction:vi.fn(async(fn:any)=>fn(tx))};}
describe("database fixture provisioning",()=>{
 it("creates User and maps trigger-created profile",async()=>{const d=db();const r=await provisionLegacyIdentity(d as any,{authUserId:"00000000-0000-0000-0000-000000000001",email:"phase3-test-agent@example.test",name:"Test Agent",role:"AGENT"});expect(r.role).toBe("AGENT");expect(d.transaction).toHaveBeenCalled();});
 it("rolls back on constraint failure",async()=>{const d=db();d.tx.query.mockRejectedValueOnce(new Error("23505"));await expect(provisionLegacyIdentity(d as any,{authUserId:"x",email:"phase3-test-agent@example.test",name:"x",role:"AGENT"})).rejects.toThrow("23505");});
 it("rejects duplicate identity",async()=>{const d=db();d.tx.query.mockReset();d.tx.query.mockResolvedValueOnce({rows:[{id:"existing"}]});await expect(provisionLegacyIdentity(d as any,{authUserId:"x",email:"phase3-test-agent@example.test",name:"x",role:"AGENT"})).rejects.toThrow("already exists");});
});
