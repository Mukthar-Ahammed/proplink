"use server";

import { z } from "zod";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  generateRecoveryCodes,
  isRecentlyAuthenticated,
  mfaVerifyLimits,
  redeemRecoveryCode,
  remainingRecoveryCodes,
} from "@/services/auth/mfa";

/**
 * MFA server actions (Phase 1 Task 11, ADR-030). They use `auth()` directly,
 * not `requireUser()`, because an Admin at `aal1` must be able to reach them.
 * Every code check shares one rate limit (5 per 15 minutes per user).
 */

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

export type EnrollStart =
  | { kind: "error"; message: string }
  | { kind: "enrolling"; factorId: string; qrCode: string; secret: string };

export type VerifyState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "verified"; recoveryCodes: string[] | null };

const LIMITED = "Too many attempts. Wait 15 minutes and try again.";

async function signedIn() {
  const session = await auth();
  return session?.user ?? null;
}

/** Starts TOTP enrolment, clearing any abandoned unverified factor first. */
export async function startEnrollmentAction(): Promise<EnrollStart> {
  const user = await signedIn();
  if (!user) return { kind: "error", message: "Sign in first." };
  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { kind: "error", message: "Could not start set-up. Try again." };
  if (factors.totp.some((factor) => factor.status === "verified")) {
    return { kind: "error", message: "An authenticator is already set up." };
  }
  for (const factor of factors.all) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "PropLink authenticator",
  });
  if (error || !data)
    return { kind: "error", message: "Could not start set-up. Try again." };
  return {
    kind: "enrolling",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Confirms enrolment with the first code and issues recovery codes once. */
export async function verifyEnrollmentAction(
  _previous: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const user = await signedIn();
  if (!user) return { kind: "error", message: "Sign in first." };
  const code = codeSchema.safeParse(formData.get("code"));
  const factorId = z.uuid().safeParse(formData.get("factorId"));
  if (!code.success || !factorId.success) {
    return { kind: "error", message: "Enter the 6-digit code from your app." };
  }
  if (!(await consumeRateLimits("mfa_verify", mfaVerifyLimits(user.authUserId)))) {
    return { kind: "error", message: LIMITED };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factorId.data,
    code: code.data,
  });
  if (error)
    return { kind: "error", message: "That code didn't match. Try the next one." };

  const actor = { profileId: user.authUserId, legacyUserId: user.id };
  await writeAudit({
    actorUserId: user.id,
    action: "MFA_ENROLLED",
    entity: "Profile",
    entityId: user.authUserId,
  });
  const recoveryCodes =
    (await remainingRecoveryCodes(user.authUserId)) === 0
      ? await generateRecoveryCodes(actor)
      : null;
  return { kind: "verified", recoveryCodes };
}

/** Raises this session to aal2 (sign-in, or re-authentication). */
export async function verifyChallengeAction(
  _previous: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const user = await signedIn();
  if (!user) return { kind: "error", message: "Sign in first." };
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success)
    return { kind: "error", message: "Enter the 6-digit code from your app." };
  if (!(await consumeRateLimits("mfa_verify", mfaVerifyLimits(user.authUserId)))) {
    return { kind: "error", message: LIMITED };
  }
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor) return { kind: "error", message: "No authenticator is set up." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: code.data,
  });
  if (error)
    return { kind: "error", message: "That code didn't match. Try the next one." };
  return { kind: "verified", recoveryCodes: null };
}

export type RecoveryState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "ok" };

export async function redeemRecoveryCodeAction(
  _previous: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const user = await signedIn();
  if (!user) return { kind: "error", message: "Sign in first." };
  const result = await redeemRecoveryCode(
    { profileId: user.authUserId, legacyUserId: user.id, sessionId: user.mfa.sessionId },
    formData.get("recoveryCode"),
  );
  return result.ok ? { kind: "ok" } : { kind: "error", message: result.error };
}

export type RegenerateState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "codes"; codes: string[] };

/** New recovery codes; needs an authenticator-verified, recent session. */
export async function regenerateRecoveryCodesAction(): Promise<RegenerateState> {
  const user = await signedIn();
  if (!user) return { kind: "error", message: "Sign in first." };
  if (user.mfa.aal !== "aal2" || !isRecentlyAuthenticated(user)) {
    return {
      kind: "error",
      message: "Verify your authenticator code first (Confirm it's you), then try again.",
    };
  }
  const codes = await generateRecoveryCodes({
    profileId: user.authUserId,
    legacyUserId: user.id,
  });
  return { kind: "codes", codes };
}
