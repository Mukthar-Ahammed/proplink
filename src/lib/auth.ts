import "server-only";

import type { InvestorType, KycStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { MFA_REQUIRED_ROLES } from "@/lib/mfaRoles";
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
    /** Phase 1 Task 11 (ADR-030): from the validated access token. */
    mfa: SessionMfa;
  };
};

export type SessionMfa = {
  /** "aal2" once a second factor was verified in this session. */
  aal: "aal1" | "aal2";
  /** Supabase session ID (stable across refreshes); null if unreadable. */
  sessionId: string | null;
  /** Most recent authentication in this session (seconds), for re-auth. */
  lastAuthAt: number | null;
};

type TokenClaims = {
  sub: string | null;
  sessionId: string | null;
  aal: "aal1" | "aal2";
  signedInAt: number | null;
  lastAuthAt: number | null;
};

/** Reads the claims this module uses from a decoded JWT payload. */
export function claimsFromPayload(payload: unknown): TokenClaims | null {
  if (!payload || typeof payload !== "object") return null;
  const {
    amr,
    iat,
    aal,
    session_id: sessionId,
    sub,
  } = payload as Record<string, unknown>;
  const stamps = Array.isArray(amr)
    ? amr
        .map((entry) =>
          entry && typeof entry === "object"
            ? (entry as { timestamp?: unknown }).timestamp
            : undefined,
        )
        .filter((value): value is number => typeof value === "number" && value > 0)
    : [];
  const issuedAt = typeof iat === "number" && iat > 0 ? iat : null;
  return {
    sub: typeof sub === "string" ? sub : null,
    sessionId: typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null,
    aal: aal === "aal2" ? "aal2" : "aal1",
    signedInAt: stamps.length > 0 ? Math.min(...stamps) : issuedAt,
    lastAuthAt: stamps.length > 0 ? Math.max(...stamps) : issuedAt,
  };
}

function decodePayload(accessToken: string): unknown {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

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

  // Token claims. getUser() has just validated this session's token with
  // Auth, so the stored token is read locally. Roles whose MFA gate depends on
  // the `aal` claim use getClaims(), which verifies the signature itself.
  let claims: TokenClaims | null;
  if (MFA_REQUIRED_ROLES.includes(profile.role)) {
    const { data, error: claimsError } = await supabase.auth.getClaims();
    claims = claimsError || !data ? null : claimsFromPayload(data.claims);
  } else {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    claims = session ? claimsFromPayload(decodePayload(session.access_token)) : null;
  }
  if (claims?.sub && claims.sub !== user.id) return null;

  // Phase 1 Task 9 (ADR-028): a suspension revokes every session that signed
  // in before it, including ones refreshed later.
  if (profile.sessionsRevokedAt) {
    const signedInAt = claims?.signedInAt ?? null;
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
      mfa: {
        aal: claims?.aal ?? "aal1",
        sessionId: claims?.sessionId ?? null,
        lastAuthAt: claims?.lastAuthAt ?? null,
      },
    },
  };
}

/**
 * When the session behind this access token first signed in, in seconds:
 * the earliest `amr` timestamp (these survive refreshes), else `iat`.
 */
export function sessionSignedInAt(accessToken: string): number | null {
  return claimsFromPayload(decodePayload(accessToken))?.signedInAt ?? null;
}
