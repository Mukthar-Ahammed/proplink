import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { InvestorType, KycStatus, Role } from "@/generated/prisma/enums";
import { auth, type AppSession } from "@/lib/auth";
import { getInvestorCapabilities } from "@/services/syndicates/investorType";
import { isMfaSatisfied, requiresMfa } from "@/services/auth/mfa";

export type AuthzResult =
  { ok: true; session: AppSession } | { ok: false; response: NextResponse };

export type InvestorCapability = "FLIPPER" | "SYNDICATE";
export type AuthenticationAudience = "USER" | "ADMIN";
export type VerificationKind = "KYC";

type RoleSubject = Pick<AppSession["user"], "role">;
type InvestorSubject = Pick<AppSession["user"], "role" | "investorType">;
type FinancialInvestorSubject = Pick<
  AppSession["user"],
  "role" | "investorType" | "kycStatus" | "active"
>;

/** Keeps privileged credentials out of the public account sign-in flow. */
export function isAuthenticationAudienceAllowed(
  user: RoleSubject,
  audience: AuthenticationAudience,
): boolean {
  return audience === "ADMIN" ? user.role === Role.ADMIN : user.role !== Role.ADMIN;
}

export function hasAllowedRole(user: RoleSubject, roles: readonly Role[]): boolean {
  return roles.length === 0 || roles.includes(user.role);
}

export function hasInvestorCapability(
  user: InvestorSubject,
  capability: InvestorCapability,
): boolean {
  const capabilities = getInvestorCapabilities(user);
  return capability === InvestorType.FLIPPER
    ? capabilities.flipper
    : capabilities.syndicate;
}

export function isInvestorFinanciallyEligible(
  user: FinancialInvestorSubject,
  capability: InvestorCapability,
): boolean {
  return (
    user.active === true &&
    user.role === Role.INVESTOR &&
    hasInvestorCapability(user, capability) &&
    user.kycStatus === KycStatus.APPROVED
  );
}

function authenticationRequired(): AuthzResult {
  return {
    ok: false,
    response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
  };
}

function forbidden(): AuthzResult {
  return {
    ok: false,
    response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  };
}

export class NotImplementedError extends Error {
  constructor(guard: string) {
    super(`${guard} authorization is not implemented`);
    this.name = "NotImplementedError";
  }
}

function mfaRequired(): AuthzResult {
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Multi-factor authentication required", mfa: "/mfa" },
      { status: 403 },
    ),
  };
}

/**
 * Every guard below starts here. Admin and Solicitor sessions without a
 * verified second factor are refused (Phase 1 Task 11, ADR-030).
 */
export async function requireUser(): Promise<AuthzResult> {
  const session = await auth();
  if (!session?.user) return authenticationRequired();
  if (requiresMfa(session.user.role) && !(await isMfaSatisfied(session.user))) {
    return mfaRequired();
  }
  return { ok: true, session };
}

/**
 * Route-handler authorization. `auth()` has already verified Supabase Auth,
 * active Profile/User state and the compatibility mapping before this role
 * check runs.
 */
export async function requireRole(...roles: Role[]): Promise<AuthzResult> {
  const result = await requireUser();
  if (!result.ok) return result;
  if (!hasAllowedRole(result.session.user, roles)) return forbidden();
  return result;
}

/** Call only with an owner ID loaded from an authorized server-side query. */
export async function requireOwnership(ownerUserId: string): Promise<AuthzResult> {
  const result = await requireUser();
  if (!result.ok) return result;
  if (
    ownerUserId !== result.session.user.id &&
    ownerUserId !== result.session.user.authUserId
  ) {
    return forbidden();
  }
  return result;
}

export async function requireVerified(kind: VerificationKind): Promise<AuthzResult> {
  const result = await requireUser();
  if (!result.ok) return result;
  if (kind === "KYC" && result.session.user.kycStatus !== KycStatus.APPROVED) {
    return forbidden();
  }
  return result;
}

/** Page-level gate. Layout and Proxy checks are deliberately not relied upon. */
export async function requirePageRole(...roles: Role[]): Promise<AppSession> {
  const session = await auth();
  if (!session?.user) {
    redirect(roles.includes(Role.ADMIN) ? "/admin/login" : "/login");
  }
  if (!hasAllowedRole(session.user, roles)) redirect("/403");
  if (requiresMfa(session.user.role) && !(await isMfaSatisfied(session.user))) {
    redirect("/mfa");
  }
  return session;
}

export async function requireInvestorType(
  capability: InvestorCapability,
): Promise<AuthzResult> {
  const result = await requireRole(Role.INVESTOR);
  if (!result.ok) return result;
  if (!hasInvestorCapability(result.session.user, capability)) return forbidden();
  return result;
}

export async function requireInvestorFinancialEligibility(
  capability: InvestorCapability,
): Promise<AuthzResult> {
  const result = await requireRole(Role.INVESTOR);
  if (!result.ok) return result;
  if (!isInvestorFinanciallyEligible(result.session.user, capability)) {
    return forbidden();
  }
  return result;
}

/** Existing generic KYC gate, retained for compatibility and made non-leaky. */
export async function requireKyc(): Promise<AuthzResult> {
  return requireVerified("KYC");
}

/**
 * Phase 3 Task 1 (ADR-042): paid features need an active subscription, or a
 * failed payment still inside the grace period. Roles that never pay
 * (Landlords, Buyers) pass. Refusals use 402 so clients can offer billing.
 */
export async function requireSubscription(): Promise<AuthzResult> {
  const result = await requireUser();
  if (!result.ok) return result;
  // Imported lazily: the billing service depends on modules that import this one.
  const { allowsPaidFeatures, subscriptionState } =
    await import("@/services/billing/subscriptions");
  const state = await subscriptionState({
    profileId: result.session.user.authUserId,
    role: result.session.user.role,
  });
  if (!allowsPaidFeatures(state)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "An active subscription is required", billing: "/account/billing" },
        { status: 402 },
      ),
    };
  }
  return result;
}

/**
 * Phase 3 Task 2 (ADR-043): may the signed-in user send on this thread? Admin
 * authorisation AND subscriptions where required, checked on every call.
 */
export async function requireChatAuthorization(threadId: string): Promise<AuthzResult> {
  const result = await requireUser();
  if (!result.ok) return result;
  const { threadAccess } = await import("@/services/chat/threads");
  const access = await threadAccess(
    { profileId: result.session.user.authUserId, role: result.session.user.role },
    threadId,
  );
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: access.status }),
    };
  }
  if (!access.canSend) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This chat is not open", blocked: access.blocked },
        { status: access.blocked === "your_subscription" ? 402 : 403 },
      ),
    };
  }
  return result;
}

export async function requireProjectAccess(): Promise<never> {
  throw new NotImplementedError("Project");
}
