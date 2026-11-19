"use server";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMfaSatisfied } from "@/services/auth/mfa";

/**
 * Which card the Admin sign-in page shows for the current session (ADR-030):
 * the password card, the authenticator-code card, the authenticator set-up
 * card, or none (fully signed in, go to /admin). The second factor is asked
 * for on the same page, so the site chrome and sign-out never appear before
 * an Admin has passed both steps.
 */
export type AdminLoginStep = "password" | "challenge" | "enroll" | "done";

export async function adminLoginStep(): Promise<AdminLoginStep> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return "password";
  if (await isMfaSatisfied(session.user)) return "done";
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  return factors?.totp.some((f) => f.status === "verified") ? "challenge" : "enroll";
}

export async function adminLoginStepAction(): Promise<AdminLoginStep> {
  return adminLoginStep();
}

/** Abandons a half-finished Admin sign-in (password done, code not yet). */
export async function cancelAdminLoginAction(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/admin/login");
}
