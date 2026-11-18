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
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async () => []),
    $executeRaw: vi.fn(),
    profile: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    agentCompanyCheck: { findUnique: vi.fn(async () => null) },
    landlordListing: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
    chatThread: { findUnique: vi.fn(async () => null) },
    // Phase 4 rows: the data is absent, so an allowed role gets past the role
    // gate and stops at "not found / not open"; a refused role gets 403/404.
    mandate: { findFirst: vi.fn(async () => null) },
    investorProject: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
    projectPledge: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { amountGBP: null } })),
    },
    projectSolicitor: { findFirst: vi.fn(async () => null) },
    projectFundStatus: { create: vi.fn(async () => ({})) },
    chatThreadMessage: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn() },
  },
}));
// Rate limits are tested on their own; here every call is within the limit.
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/auth/supabaseAuthService")>()),
  consumeRateLimits: vi.fn(async () => true),
}));
// Phase 3: subscriptions are tested in billing tests; here they are active.
vi.mock("@/services/billing/subscriptions", () => ({
  audiencesFor: (role: string) =>
    role === "AGENT" ? ["AGENT"] : role === "INVESTOR" ? ["LEAD_INVESTOR"] : [],
  subscriptionState: vi.fn(async () => ({ state: "active" })),
  allowsPaidFeatures: () => true,
}));
// The company check itself is Phase 1's (ADR-024) and tested there; here it
// passes, so only the role decides.
vi.mock("@/services/agents/companyGate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/agents/companyGate")>()),
  agentCompanyGate: vi.fn(async () => ({ allowed: true, reason: "verified" })),
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
import { createListingAction } from "@/app/landlord/listings/actions";
import { createOnBehalfAction } from "@/app/admin/landlord-listings/new/actions";
import { requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { listMarketplace } from "@/services/landlord/marketplace";
import { adminReadThread } from "@/services/chat/messages";
import { threadAccess } from "@/services/chat/threads";
import { createPledge } from "@/services/projects/pledges";
import { publishProject } from "@/services/projects/projects";
import { relistProject } from "@/services/projects/relist";
import { recordFundStatus } from "@/services/projects/works";

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

  /** Phase 2 Task 1: Landlord creates their own; Admin creates on a Landlord's behalf. */
  async create_private_listing(role) {
    mocks.auth.mockResolvedValue(sessionAs(role));
    const form = new FormData();
    form.set("title", "Victorian terrace");
    form.set("propertyKind", "PROPERTY");
    form.set("landlordEmail", "landlord@example.test");
    let landlordPath: "allow" | "deny";
    try {
      const state = await createListingAction({ kind: "idle" }, form);
      landlordPath =
        state.kind === "error" && state.message === "Sign in as a Landlord"
          ? "deny"
          : "allow";
    } catch (error) {
      // Success redirects to the new draft.
      expect(String(error)).toContain("NEXT_REDIRECT:/landlord/listings/");
      landlordPath = "allow";
    }
    const admin = await createOnBehalfAction({ kind: "idle" }, form);
    const adminPath =
      admin.kind === "error" && admin.message === "Admin access required"
        ? "deny"
        : "allow";
    return landlordPath === "allow" || adminPath === "allow" ? "allow" : "deny";
  },

  /**
   * Phase 2 Tasks 1, 3 and 5: the Landlord's portal (own listings only, scoped
   * in the service), the verified-Agent marketplace (approved listings) and
   * the Admin review pages.
   */
  /**
   * Phase 3 (ADR-043): an authorised Landlord ↔ Agent listing chat. Who can be
   * a participant (the listing's Landlord, an Agent with a proposal) is
   * enforced by the database trigger (tests/integration/chat-db.test.ts);
   * here the real access rule runs with the session in its seat. Admin may
   * read with a logged reason (moderation), never post.
   */
  async chat_with_landlord_on_listing(role) {
    const session = sessionAs(role);
    mocks.auth.mockResolvedValue(session);
    const me = session.user.authUserId;
    const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const thread = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      contextType: "PRIVATE_LISTING",
      contextId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      pairType: "LANDLORD_AGENT",
      participantA: role === Role.LANDLORD ? me : other,
      participantB: role === Role.AGENT ? me : other,
      status: "AUTHORIZED",
      a: { name: "A" },
      b: { name: "B" },
    };
    vi.mocked(db.chatThread.findUnique).mockResolvedValue(thread as never);
    vi.mocked(db.profile.findUnique).mockImplementation((async () => ({
      role,
      active: true,
    })) as never);
    try {
      const access = await threadAccess({ profileId: me, role }, thread.id);
      const participant = access.ok && access.canSend;
      const moderation = (
        await adminReadThread(
          { profileId: me, legacyUserId: session.user.id, role },
          thread.id,
          "Reviewing a reported chat",
        )
      ).ok;
      return participant || moderation ? "allow" : "deny";
    } finally {
      vi.mocked(db.chatThread.findUnique).mockResolvedValue(null);
      vi.mocked(db.profile.findUnique).mockImplementation((async () => null) as never);
    }
  },

  /**
   * Phase 4 (ADR-044): publishing needs the Agent of an ACTIVE mandate
   * (database-checked) or Admin on their behalf. With no mandate in the
   * mock, an allowed role reaches the mandate lookup (409); others get 403.
   */
  async publish_to_investor_portal(role) {
    const session = sessionAs(role);
    vi.mocked(db.profile.findUnique).mockImplementation((async () => ({
      active: true,
      role,
      legacyUserId: session.user.id,
    })) as never);
    try {
      const result = await publishProject(
        { profileId: session.user.authUserId, legacyUserId: session.user.id, role },
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
        {},
      );
      return result.ok || !denied(result.status) ? "allow" : "deny";
    } finally {
      vi.mocked(db.profile.findUnique).mockImplementation((async () => null) as never);
    }
  },

  /**
   * Phase 5 (ADR-052): the project's Agent re-lists a completed project for
   * sale, or an Admin on their behalf (audited). Others are refused (403)
   * before any project lookup; the allowed roles reach "not found" (404).
   */
  async publish_to_retail_portal(role) {
    const session = sessionAs(role);
    const result = await relistProject(
      { profileId: session.user.authUserId, legacyUserId: session.user.id, role },
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      {},
    );
    return result.ok || !denied(result.status) ? "allow" : "deny";
  },

  /**
   * Phase 4 (ADR-045): only KYC-approved Investors pledge (database-checked
   * too); no money moves. An Investor reaches "not open" (409) here.
   */
  async pledge_capital(role) {
    const session = sessionAs(role);
    vi.mocked(db.profile.findUnique).mockImplementation((async () => ({
      kycStatus: "APPROVED",
      active: true,
    })) as never);
    try {
      const result = await createPledge(
        { profileId: session.user.authUserId, legacyUserId: session.user.id, role },
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
        "1000",
        "matrix-key-0001",
      );
      return result.ok || !denied(result.status) ? "allow" : "deny";
    } finally {
      vi.mocked(db.profile.findUnique).mockImplementation((async () => null) as never);
    }
  },

  /**
   * Phase 4 (ADR-047, ADR-049): the project's ACTIVE Solicitor records funds
   * status (and proposes ledger corrections, ADR-050). Everyone else,
   * Admin included, gets "not found".
   */
  async post_fund_status_or_propose_ledger_correction(role) {
    const session = sessionAs(role);
    const projectId = "abababab-abab-4bab-8bab-abababababab";
    vi.mocked(db.projectPledge.findUnique).mockResolvedValue({
      projectId,
      investorId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      project: { title: "Matrix project" },
    } as never);
    vi.mocked(db.investorProject.findUnique).mockResolvedValue({
      agentId: "efefefef-efef-4fef-8fef-efefefefefef",
      leadInvestorId: null,
      listing: { ownerId: "12121212-1212-4212-8212-121212121212" },
    } as never);
    vi.mocked(db.projectSolicitor.findFirst).mockImplementation((async () =>
      role === Role.SOLICITOR ? { projectId } : null) as never);
    try {
      const result = await recordFundStatus(
        { profileId: session.user.authUserId, legacyUserId: session.user.id, role },
        "34343434-3434-4434-8434-343434343434",
        { status: "RECEIVED" },
      );
      return result.ok ? "allow" : "deny";
    } finally {
      vi.mocked(db.projectPledge.findUnique).mockResolvedValue(null);
      vi.mocked(db.investorProject.findUnique).mockResolvedValue(null);
      vi.mocked(db.projectSolicitor.findFirst).mockResolvedValue(null);
    }
  },

  async view_private_landlord_listing(role) {
    mocks.auth.mockResolvedValue(sessionAs(role));
    const session = sessionAs(role);
    // An active account of this role. A fixed implementation, not a one-off
    // value: non-Agents are refused before the lookup, and an unconsumed
    // one-off value would leak into the next role's check.
    vi.mocked(db.profile.findUnique).mockImplementation((async () => ({
      active: true,
      role,
      legacyUserId: session.user.id,
    })) as never);
    let marketplace: boolean;
    try {
      marketplace = (
        await listMarketplace(
          { profileId: session.user.authUserId, legacyUserId: session.user.id, role },
          {},
        )
      ).ok;
    } finally {
      vi.mocked(db.profile.findUnique).mockImplementation((async () => null) as never);
    }
    const landlordPortal = (await requireRole(Role.LANDLORD)).ok;
    const adminReview = (await requireRole(Role.ADMIN)).ok;
    return landlordPortal || marketplace || adminReview ? "allow" : "deny";
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
