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
