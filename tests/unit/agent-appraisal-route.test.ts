import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/agents/[id]/appraisals/route";

/** Retired by Phase 5 Task 4 (ADR-054): reviews only from qualifying interactions. */
describe("POST /api/agents/[id]/appraisals", () => {
  it("is gone: no appraisal can be posted", async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/account\/reviews/);
  });
});
