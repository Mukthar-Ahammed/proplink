import { describe, expect, it } from "vitest";
import { classify } from "../../scripts/reconcile-phase3-fixtures.mjs";
const e={email:"phase3-test-agent@example.test",marker:"m",role:"AGENT"}; const a={id:"a",email:e.email}; const r={id:"a",email:e.email,marker:"m",role:"AGENT",userRole:"AGENT",active:true,userActive:true,kycStatus:"NOT_STARTED",userKyc:"NOT_STARTED"};
describe("fixture reconciliation",()=>{it("verifies matching identity",()=>expect(classify(e,a,r)).toBe("VERIFIED"));it("detects missing Auth",()=>expect(classify(e,null,r)).toBe("MISSING"));it("detects conflict",()=>expect(classify(e,a,{...r,userRole:"BUYER"})).toBe("CONFLICT"));it("detects incomplete mapping",()=>expect(classify(e,a,null)).toBe("INCOMPLETE"));});
