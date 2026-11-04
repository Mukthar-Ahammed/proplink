"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { z } from "zod";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { Role, type Role as AppRole } from "@/generated/prisma/enums";
import { createClient } from "@/lib/supabase/server";
import {
  appOrigin,
  bridgeVerifiedUser,
  clearRateLimits,
  consumeRateLimits,
  createRecoveryGrant,
  createSignupIntent,
  credentialsSchema,
  discardSignupIntent,
  investorSignupSchema,
  investorTypeEnumSchema,
  loginLimits,
  passwordSchema,
  rateLimitsExceeded,
  recordConsumedToken,
  RECOVERY_GRANT_COOKIE,
  recoveryGrantIsValid,
  resendLimits,
  signupLimits,
  signupSchema,
  tokenWasConsumed,
} from "@/services/auth/supabaseAuthService";
import { completeInvestorTypeOnboarding, investorTypeSchema } from "@/services/syndicates/investorType";
import { isAuthenticationAudienceAllowed, requireRole } from "@/lib/authz";
import { auth } from "@/lib/auth";
import { verifyTurnstileToken } from "@/services/security/turnstile";

export type AuthActionResult = {
  kind: "idle" | "error" | "success" | "unconfirmed" | "limited";
  message?: string;
  cooldownSeconds?: number;
  destination?: string;
};

const GENERIC_SIGNUP =
  "If this address can be registered, we have sent a confirmation email.";
const GENERIC_RESEND =
  "If an unconfirmed account exists, a confirmation email will be sent.";
const GENERIC_RESET = "If an account exists, a password reset email will be sent.";
const INVALID_CREDENTIALS = "Invalid email or password";
const INVALID_ADMIN_CREDENTIALS = "Invalid admin credentials";
const LOGIN_LIMITED = "Too many login attempts. Try again later.";

async function requestIp(): Promise<string> {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown"
  );
}

async function verifyHuman(
  token: string | undefined,
): Promise<AuthActionResult | null> {
  const result = await verifyTurnstileToken(token, await requestIp());
  if (result.ok) return null;
  return {
    kind: "error",
    message:
      result.reason === "unavailable"
        ? "Security verification is temporarily unavailable. Please try again."
        : "Please complete the security verification and try again.",
  };
}

async function minimumResponseTime(startedAt: number, milliseconds = 500) {
  const remaining = milliseconds - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function signupAs(role: AppRole, raw: unknown): Promise<AuthActionResult> {
  const startedAt = Date.now();
  const isInvestor = role === Role.INVESTOR;
  const schema = (isInvestor ? investorSignupSchema : signupSchema)
    .extend({ turnstileToken: z.string().max(2048).optional() })
    .strict();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", message: parsed.error.issues[0]?.message };
  }

  const parsedInvestorType =
    isInvestor && "investorType" in parsed.data
      ? investorTypeEnumSchema.safeParse(parsed.data.investorType)
      : null;
  if (isInvestor && !parsedInvestorType?.success) {
    return { kind: "error", message: "Select a valid investor type" };
  }
  const investorType = parsedInvestorType?.success
    ? parsedInvestorType.data
    : null;

  const ip = await requestIp();
  const humanVerification = await verifyHuman(parsed.data.turnstileToken);
  if (humanVerification) return humanVerification;
  const allowed = await consumeRateLimits(
    "signup",
    signupLimits(parsed.data.email, ip),
  );
  if (!allowed) {
    await minimumResponseTime(startedAt);
    return { kind: "success", message: GENERIC_SIGNUP };
  }

  const nonce = await createSignupIntent(role, parsed.data, investorType);
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${appOrigin()}/auth/confirm`,
        data: { proplink_signup_nonce: nonce },
      },
    });
    // With Supabase email confirmation disabled, signUp returns an active
    // session and the user can continue directly into the portal. When
    // confirmation is enabled, no session is returned and the existing
    // check-email flow remains in place.
    let destination = data.session ? "/portal" : "/check-email?purpose=signup";

    // Some Supabase projects do not return a session from signUp even after
    // confirmation is disabled. In that configuration, a normal password
    // sign-in is the supported way to establish the session. If it is still
    // rejected as unconfirmed, retain the normal verification fallback.
    if (!data.session) {
      const signedIn = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (signedIn.data.session && signedIn.data.user) {
        destination = "/portal";
      }
    }
    await minimumResponseTime(startedAt);
    return { kind: "success", message: GENERIC_SIGNUP, destination };
  } finally {
    await discardSignupIntent(nonce);
  }
}

export async function signupBuyer(raw: unknown) {
  return signupAs(Role.BUYER, raw);
}

export async function signupInvestor(raw: unknown) {
  return signupAs(Role.INVESTOR, raw);
}

export async function completeInvestorOnboardingAction(rawType: unknown) {
  const authz = await requireRole(Role.INVESTOR);
  if (!authz.ok) return { kind: "error" as const, message: "Forbidden" };

  const parsed = investorTypeSchema.safeParse(rawType);
  if (!parsed.success) {
    return { kind: "error" as const, message: "Invalid investor type selected" };
  }

  const result = await completeInvestorTypeOnboarding({
    userId: authz.session.user.authUserId ?? authz.session.user.id,
    requestedType: parsed.data,
  });

  if (!result.ok) {
    return { kind: "error" as const, message: result.error };
  }

  return { kind: "success" as const, investorType: result.investorType };
}

async function loginForAudience(
  audience: "USER" | "ADMIN",
  raw: unknown,
  requestedDestination?: string,
): Promise<AuthActionResult & { destination?: string }> {
  const parsed = credentialsSchema
    .extend({ turnstileToken: z.string().max(2048).optional() })
    .strict()
    .safeParse(raw);
  const invalidMessage =
    audience === "ADMIN" ? INVALID_ADMIN_CREDENTIALS : INVALID_CREDENTIALS;
  if (!parsed.success) return { kind: "error", message: invalidMessage };

  const ip = await requestIp();
  const humanVerification = await verifyHuman(parsed.data.turnstileToken);
  if (humanVerification) return humanVerification;
  const limits = loginLimits(parsed.data.email, ip);
  if (await rateLimitsExceeded("login_failure", limits)) {
    return {
      kind: "limited",
      message: LOGIN_LIMITED,
      cooldownSeconds: 15 * 60,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user || !data.session) {
    if (error?.code === "email_not_confirmed") {
      return {
        kind: "unconfirmed",
        message: "Please verify your email to continue",
        cooldownSeconds: 60,
      };
    }
    await consumeRateLimits("login_failure", limits);
    return { kind: "error", message: invalidMessage };
  }

  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      kind: "unconfirmed",
      message: "Please verify your email to continue",
      cooldownSeconds: 60,
    };
  }

  try {
    await bridgeVerifiedUser(data.user);
  } catch {
    await supabase.auth.signOut({ scope: "local" });
    await consumeRateLimits("login_failure", limits);
    return { kind: "error", message: invalidMessage };
  }

  const session = await auth();
  const isAdmin = session?.user.role === Role.ADMIN;
  if (!session || !isAuthenticationAudienceAllowed(session.user, audience)) {
    await supabase.auth.signOut({ scope: "local" });
    await consumeRateLimits("login_failure", limits);
    return {
      kind: "error",
      message:
        audience === "USER" && isAdmin
          ? "Admin accounts must use the Admin sign-in page."
          : invalidMessage,
    };
  }

  await clearRateLimits("login_failure", limits);
  if (audience === "ADMIN") {
    return { kind: "success", destination: "/admin" };
  }

  const destination =
    requestedDestination && /^\/(?!\/)/.test(requestedDestination)
      ? requestedDestination
      : "/portal";
  return { kind: "success", destination };
}

export async function loginAction(
  raw: unknown,
  requestedDestination?: string,
): Promise<AuthActionResult & { destination?: string }> {
  return loginForAudience("USER", raw, requestedDestination);
}

export async function adminLoginAction(
  raw: unknown,
): Promise<AuthActionResult & { destination?: string }> {
  return loginForAudience("ADMIN", raw);
}

export async function resendConfirmationAction(
  rawEmail: unknown,
  rawTurnstileToken?: unknown,
): Promise<AuthActionResult> {
  const parsed = credentialsSchema.shape.email.safeParse(rawEmail);
  if (!parsed.success) return { kind: "success", message: GENERIC_RESEND };

  const ip = await requestIp();
  const token = z.string().max(2048).optional().safeParse(rawTurnstileToken);
  if (!token.success) return { kind: "success", message: GENERIC_RESEND };
  const humanVerification = await verifyHuman(token.data);
  if (humanVerification) return humanVerification;
  const allowed = await consumeRateLimits(
    "confirmation_resend",
    resendLimits(parsed.data, ip),
  );
  if (allowed) {
    const supabase = await createClient();
    await supabase.auth.resend({
      type: "signup",
      email: parsed.data,
      options: { emailRedirectTo: `${appOrigin()}/auth/confirm` },
    });
  }

  return { kind: "success", message: GENERIC_RESEND, cooldownSeconds: 60 };
}

export async function confirmAuthToken(tokenHash: string, type: string): Promise<never> {
  if (!tokenHash || !["email", "recovery"].includes(type)) {
    redirect("/auth/confirm?error=invalid");
  }
  if (await tokenWasConsumed(tokenHash)) {
    redirect("/auth/confirm?error=reused");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as EmailOtpType,
  });
  if (error || !data.user) redirect("/auth/confirm?error=expired");

  await recordConsumedToken(tokenHash, type as "email" | "recovery", data.user.id);
  if (type === "recovery") {
    if (!data.user.email_confirmed_at) {
      await supabase.auth.signOut({ scope: "local" });
      redirect("/auth/confirm?error=unverified");
    }
    const grant = createRecoveryGrant(data.user.id);
    const cookieStore = await cookies();
    cookieStore.set(RECOVERY_GRANT_COOKIE, grant.value, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: grant.maxAge,
    });
    redirect("/reset-password");
  }

  await bridgeVerifiedUser(data.user);
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?confirmed=1");
}

export async function requestPasswordResetAction(
  rawEmail: unknown,
  rawTurnstileToken?: unknown,
): Promise<AuthActionResult> {
  const parsed = credentialsSchema.shape.email.safeParse(rawEmail);
  if (!parsed.success) return { kind: "success", message: GENERIC_RESET };

  const ip = await requestIp();
  const token = z.string().max(2048).optional().safeParse(rawTurnstileToken);
  if (!token.success) return { kind: "success", message: GENERIC_RESET };
  const humanVerification = await verifyHuman(token.data);
  if (humanVerification) return humanVerification;
  const allowed = await consumeRateLimits(
    "password_reset",
    resendLimits(parsed.data, ip),
  );
  if (allowed) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${appOrigin()}/auth/confirm`,
    });
  }
  return { kind: "success", message: GENERIC_RESET, cooldownSeconds: 60 };
}

export async function resetPasswordAction(rawPassword: unknown): Promise<AuthActionResult> {
  const parsed = passwordSchema.safeParse(rawPassword);
  if (!parsed.success) {
    return { kind: "error", message: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cookieStore = await cookies();
  const grant = cookieStore.get(RECOVERY_GRANT_COOKIE)?.value;
  if (!user?.email_confirmed_at || !recoveryGrantIsValid(grant, user.id)) {
    return {
      kind: "error",
      message: "This reset session is invalid or expired. Request a new reset email.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { kind: "error", message: "Unable to update the password." };

  cookieStore.delete(RECOVERY_GRANT_COOKIE);
  await supabase.auth.signOut({ scope: "local" });
  return { kind: "success", message: "Password updated. Log in with your new password." };
}

export async function logoutAction(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
