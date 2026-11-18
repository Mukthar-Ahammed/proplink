import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Permission-matrix harness (Phase 1 Task 13, ADR-033). For every capability
 * and role in `PERMISSION_MATRIX`, the real guard (route handler, server
 * action or service) is called as that role and the result compared with the
 * expected cell. Capabilities not delivered yet must deny everyone; the phase
 * that delivers one registers its checker below and sets `deliveredInPhase`.
 * Database-level (RLS / trigger) checks for the same rows live in
 * `tests/integration/*-db.test.ts`.
 */

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async () => []),
    $executeRaw: vi.fn(),
    profile: { findUnique: vi.fn(async () => null) },
    agentCompanyCheck: { findUnique: vi.fn(async () => null) },
    auditLog: { create: vi.fn() },
  },
}));

import { Role } from "@/generated/prisma/enums";
import {
  CURRENT_PHASE,
  expectedCell,
  MATRIX_ROLES,
  PERMISSION_MATRIX,
  type Cell,
  type MatrixRole,
} from "@/lib/authz/permissionMatrix";
import { awardBadgeAction } from "@/app/admin/badges/actions";
import { overrideCompanyCheckAction } from "@/app/admin/agents/companies/actions";
import { POST as postOffer } from "@/app/api/offers/route";
import { POST as postViewing } from "@/app/api/viewings/route";
import { createSignupIntent } from "@/services/auth/supabaseAuthService";

function sessionAs(role: MatrixRole) {
  return {
    user: {
      id: `legacy-${role.toLowerCase()}`,
      authUserId: "00000000-0000-4000-8000-000000000001",
      email: `${role.toLowerCase()}@example.test`,
      name: role,
      image: null,
      role,
      active: true,
      investorType: role === Role.INVESTOR ? "SYNDICATE" : null,
      kycStatus: "APPROVED",
      // A fully verified session, so only the role decides the result.
      mfa: { aal: "aal2", sessionId: "s", lastAuthAt: Math.floor(Date.now() / 1000) },
    },
  };
}

const denied = (status: number) => status === 401 || status === 403;

/** One checker per delivered capability: resolves to the actual cell. */
const CHECKERS: Record<string, (role: MatrixRole) => Promise<Cell>> = {
  async self_register(role) {
    try {
      await createSignupIntent(
        role,
        { email: "new@example.test", name: "New Person" },
        (role === Role.INVESTOR ? "SYNDICATE" : null) as never,
      );
      return "allow";
    } catch (error) {
      return /Only self-serve roles/.test(String(error)) ? "deny" : "allow";
    }
  },

  async verify_accounts_assign_badges(role) {
    mocks.auth.mockResolvedValue(sessionAs(role));
    const form = new FormData();
    form.set("profileId", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    form.set("decision", "APPROVED");
    form.set("reason", "Checked against the register");
    const badge = await awardBadgeAction({ kind: "idle" }, form);
    const company = await overrideCompanyCheckAction({ kind: "idle" }, form);
    const blocked = (state: { kind: string; message?: string }) =>
      state.kind === "error" && state.message === "Admin access required";
    // Both Admin-only actions must agree.
    expect(blocked(badge)).toBe(blocked(company));
    return blocked(badge) ? "deny" : "allow";
  },

  async submit_retail_viewing_or_offer(role) {
    mocks.auth.mockResolvedValue(sessionAs(role));
    const request = () =>
      new Request("http://localhost/api", { method: "POST", body: "not json" });
    const offer = await postOffer(request());
    const viewing = await postViewing(request());
    expect(denied(offer.status)).toBe(denied(viewing.status));
    return denied(offer.status) ? "deny" : "allow";
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("permission matrix (section 5)", () => {
  it("covers every role for every capability", () => {
    for (const row of PERMISSION_MATRIX) {
      expect(Object.keys(row.target).sort()).toEqual([...MATRIX_ROLES].sort());
    }
    expect(new Set(PERMISSION_MATRIX.map((r) => r.capability)).size).toBe(
      PERMISSION_MATRIX.length,
    );
  });

  it("has a checker for every delivered capability, and none for undelivered ones", () => {
    for (const row of PERMISSION_MATRIX) {
      const delivered = row.deliveredInPhase <= CURRENT_PHASE;
      expect(Boolean(CHECKERS[row.capability]), row.capability).toBe(delivered);
    }
  });

  it("never lets a non-Admin verify accounts or Agents self-register (core rules)", () => {
    const verify = PERMISSION_MATRIX.find(
      (r) => r.capability === "verify_accounts_assign_badges",
    );
    const register = PERMISSION_MATRIX.find((r) => r.capability === "self_register");
    expect(Object.entries(verify!.target).filter(([, c]) => c === "allow")).toEqual([
      [Role.ADMIN, "allow"],
    ]);
    expect(register!.target[Role.AGENT]).toBe("deny");
    expect(register!.target[Role.ADMIN]).toBe("deny");
    expect(register!.target[Role.SOLICITOR]).toBe("deny");
  });

  for (const row of PERMISSION_MATRIX) {
    describe(`${row.capability} (phase ${row.deliveredInPhase})`, () => {
      for (const role of MATRIX_ROLES) {
        const expected = expectedCell(row, role);
        it(`${role} → ${expected}`, async () => {
          const checker = CHECKERS[row.capability];
          // Not delivered yet: no code path exists, so every role is denied.
          const actual: Cell = checker ? await checker(role) : "deny";
          expect(actual).toBe(expected);
        });
      }
    });
  }
});
