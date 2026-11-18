import { Role } from "@/generated/prisma/enums";

/**
 * The section 5 permission matrix (TRD §3.2, extended by the Clarification
 * Answers) as data (Phase 1 Task 13, ADR-033). Every cell is checked by
 * `tests/unit/permission-matrix.test.ts` against the real guards.
 *
 * `target` is what the business rules require. `deliveredInPhase` is the
 * phase whose code provides the capability. Until that phase, every cell is
 * expected to DENY. The phase that delivers a capability sets
 * `deliveredInPhase` to itself and registers a checker for it in the
 * harness, which then enforces `target`.
 */

export const MATRIX_ROLES = [
  Role.LANDLORD,
  Role.AGENT,
  Role.INVESTOR,
  Role.BUYER,
  Role.SOLICITOR,
  Role.ADMIN,
] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

/** The phase currently being delivered; cells from later phases expect DENY. */
export const CURRENT_PHASE = 4;

export type Cell = "allow" | "deny";

export type MatrixRow = {
  capability: string;
  /** What the business rules require once delivered (conditions in `note`). */
  target: Record<MatrixRole, Cell>;
  deliveredInPhase: number;
  note: string;
};

const row = (
  capability: string,
  allowed: readonly MatrixRole[],
  deliveredInPhase: number,
  note: string,
): MatrixRow => ({
  capability,
  target: Object.fromEntries(
    MATRIX_ROLES.map((role) => [role, allowed.includes(role) ? "allow" : "deny"]),
  ) as Record<MatrixRole, Cell>,
  deliveredInPhase,
  note,
});

export const PERMISSION_MATRIX: readonly MatrixRow[] = [
  row(
    "self_register",
    [Role.LANDLORD, Role.INVESTOR, Role.BUYER],
    1,
    "Agents invite-only; Solicitor and Admin are Admin-created.",
  ),
  row(
    "verify_accounts_assign_badges",
    [Role.ADMIN],
    1,
    "Admin only (badges ADR-027; company overrides ADR-024).",
  ),
  row(
    "submit_retail_viewing_or_offer",
    [Role.BUYER],
    0,
    "Buyers book and offer; Agents manage, Admin reads, Investors use a Buyer account.",
  ),
  row(
    "create_private_listing",
    [Role.LANDLORD, Role.ADMIN],
    2,
    "Landlord: own listing. Admin: on a Landlord's behalf, audited.",
  ),
  row(
    "view_private_landlord_listing",
    [Role.LANDLORD, Role.AGENT, Role.ADMIN],
    2,
    "Landlord: own only. Agent: verified, after Admin approval of the listing.",
  ),
  row(
    "chat_with_landlord_on_listing",
    [Role.LANDLORD, Role.AGENT, Role.ADMIN],
    3,
    "Agent: Admin-authorised thread. Admin: read/moderate with a logged reason.",
  ),
  row(
    "publish_to_investor_portal",
    [Role.AGENT, Role.ADMIN],
    4,
    "Agent: active mandate only. Admin: audited.",
  ),
  row(
    "publish_to_retail_portal",
    [Role.AGENT, Role.ADMIN],
    5,
    'Agent: completed projects. Admin: audited. Phase 5 builds the retail listing of a completed project (phase prompts); Phase 4 stops at "Listed for sale".',
  ),
  row(
    "pledge_capital",
    [Role.INVESTOR],
    4,
    "Investor with KYC approved; expression of interest only, no money moves.",
  ),
  row(
    "post_fund_status_or_propose_ledger_correction",
    [Role.SOLICITOR],
    4,
    "Solicitor: own project. Admin approves corrections (separate capability).",
  ),
];

/** The expected cell today: the target once delivered, DENY before. */
export function expectedCell(row: MatrixRow, role: MatrixRole): Cell {
  return row.deliveredInPhase <= CURRENT_PHASE ? row.target[role] : "deny";
}
