import "server-only";

import type { InvestorType, KycStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

export type AppSession = {
  user: {
    /** Legacy text business ID used by existing Prisma business tables. */
    id: string;
    /** Supabase Auth UUID; never accepted from the client. */
    authUserId: string;
    email: string;
    name: string | null;
    image: string | null;
    role: Role;
    /** `auth()` returns no session at all unless both mapped account rows are active. */
    active: boolean;
    /** Server-controlled Profile subtype; null grants no subtype capability. */
    investorType: InvestorType | null;
    kycStatus: KycStatus;
  };
};

/**
 * Returns the current server-verified application identity.
 *
 * Supabase `getUser()` validates the session with Auth. Authorization fields
 * are then loaded from the server-written profile and legacy user mapping;
 * neither user_metadata nor an unverified cookie session is trusted.
 */
export async function auth(): Promise<AppSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email || !user.email_confirmed_at) return null;

  const profile = await db.profile.findUnique({
    where: { id: user.id },
    include: { legacyUser: true },
  });
  if (!profile?.legacyUser) return null;

  // `profiles` is the authorization source. The legacy User fields remain a
  // compatibility mirror while business-table foreign keys still use CUIDs.
  // Any disagreement is an incomplete/ambiguous identity and must fail closed.
  if (
    !profile.active ||
    !profile.legacyUser.active ||
    profile.role !== profile.legacyUser.role ||
    profile.kycStatus !== profile.legacyUser.kycStatus
  ) {
    return null;
  }

  // Phase 1 Task 9 (ADR-028): a suspension revokes every session that signed
  // in before it, including ones refreshed later. Only profiles that were
  // ever suspended pay for this extra (local, no-network) session read.
  if (profile.sessionsRevokedAt) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const signedInAt = session ? sessionSignedInAt(session.access_token) : null;
    if (signedInAt === null || signedInAt * 1000 < profile.sessionsRevokedAt.getTime()) {
      return null;
    }
  }

  return {
    user: {
      id: profile.legacyUser.id,
      authUserId: user.id,
      email: user.email,
      name: profile.name ?? profile.legacyUser.name,
      image: profile.avatarUrl,
      role: profile.role,
      active: true,
      investorType: profile.investorType,
      kycStatus: profile.kycStatus,
    },
  };
}

/**
 * When the session behind this access token first signed in, in seconds.
 * Supabase records each authentication method in `amr` with its timestamp;
 * these survive token refreshes, so the earliest one is the session's sign-in
 * time. Falls back to `iat`. Only called on a token `getUser()` has already
 * validated in this request; returns null if it cannot be read.
 */
export function sessionSignedInAt(accessToken: string): number | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object") return null;
  const { amr, iat } = claims as { amr?: unknown; iat?: unknown };
  const stamps = Array.isArray(amr)
    ? amr
        .map((entry) =>
          entry && typeof entry === "object"
            ? (entry as { timestamp?: unknown }).timestamp
            : undefined,
        )
        .filter((value): value is number => typeof value === "number" && value > 0)
    : [];
  if (stamps.length > 0) return Math.min(...stamps);
  return typeof iat === "number" && iat > 0 ? iat : null;
}
