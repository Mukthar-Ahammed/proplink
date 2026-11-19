"use server";

import { redirect } from "next/navigation";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import {
  completeMockVerification,
  startProviderVerification,
} from "@/services/kyc/providerVerification";

export type VerifyFormState = { kind: "idle" } | { kind: "error"; message: string };

/** Starts provider verification and sends the user to the hosted flow. */
export async function startVerificationAction(): Promise<VerifyFormState> {
  const authz = await requireRole(Role.LANDLORD, Role.INVESTOR);
  if (!authz.ok) return { kind: "error", message: "Sign in to verify your identity" };
  const { user } = authz.session;
  const result = await startProviderVerification({
    profileId: user.authUserId,
    legacyUserId: user.id,
    role: user.role,
    kycStatus: user.kycStatus,
  });
  if (!result.ok) return { kind: "error", message: result.error };
  redirect(result.url);
}

/** Development only: plays the mock provider's decision. */
export async function completeMockVerificationAction(formData: FormData): Promise<void> {
  const authz = await requireRole(Role.LANDLORD, Role.INVESTOR);
  if (!authz.ok) redirect("/login");
  const decision = formData.get("decision") === "APPROVED" ? "APPROVED" : "REJECTED";
  const result = await completeMockVerification(authz.session.user.authUserId, decision);
  const home = authz.session.user.role === Role.INVESTOR ? "/investor/kyc" : "/landlord";
  redirect(result.status === 200 ? `${home}?verified=${decision.toLowerCase()}` : home);
}
