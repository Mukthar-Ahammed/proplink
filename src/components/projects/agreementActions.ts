"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import {
  prepareAgreement,
  reissueAgreement,
  resendSigningLink,
  sendAgreement,
  setPartyShares,
  signingLink,
  voidAgreement,
} from "@/services/projects/agreements";
import type { Actor } from "@/services/projects/common";

/**
 * Agreement actions (Phase 4 Task 6, ADR-048). Each action resolves the
 * signed-in actor with requireRole (role and MFA checks) and leaves every
 * project-level rule to the service.
 */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function actor(...roles: Role[]): Promise<Actor | null> {
  const authz = await requireRole(...roles);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

function refresh(formData: FormData) {
  const path = text(formData, "path");
  if (path.startsWith("/") && !path.startsWith("//")) revalidatePath(path);
}

/** A party asks to sign: the provider's link, or a note that it was emailed. */
export async function signAgreementAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const party = await actor(Role.INVESTOR, Role.AGENT, Role.LANDLORD);
  if (!party) return { kind: "error", message: "Sign in again" };
  const result = await signingLink(party, text(formData, "agreementId"));
  if (!result.ok) return { kind: "error", message: result.error };
  if (result.data.url) redirect(result.data.url);
  return {
    kind: "done",
    message: "The e-signature provider has emailed you a link to sign. Check your inbox.",
  };
}

/** The project's Solicitor prepares an agreement from their uploaded PDF. */
export async function prepareAgreementAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const solicitor = await actor(Role.SOLICITOR);
  if (!solicitor) return { kind: "error", message: "Sign in again" };
  const result = await prepareAgreement(solicitor, text(formData, "projectId"), {
    title: text(formData, "title"),
    draftFileId: text(formData, "draftFileId"),
    lossAllocation: text(formData, "lossAllocation"),
    cancellationPayment: text(formData, "cancellationPayment"),
    cancellationTerms: text(formData, "cancellationTerms"),
    otherTerms: text(formData, "otherTerms"),
    includeLandlord: formData.get("includeLandlord") === "on",
  });
  if (!result.ok) return { kind: "error", message: result.error };
  refresh(formData);
  return { kind: "done", message: "Draft prepared. Check the shares, then send it." };
}

export async function setSharesAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const solicitor = await actor(Role.SOLICITOR);
  if (!solicitor) return { kind: "error", message: "Sign in again" };
  const raw = Object.fromEntries(
    [...formData.entries()]
      .filter(([key]) => key.startsWith("share:"))
      .map(([key, value]) => [key.slice("share:".length), String(value)]),
  );
  const result = await setPartyShares(solicitor, text(formData, "agreementId"), raw);
  if (!result.ok) return { kind: "error", message: result.error };
  refresh(formData);
  return { kind: "done", message: "Shares saved." };
}

export async function sendAgreementAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const sender = await actor(Role.SOLICITOR, Role.ADMIN);
  if (!sender) return { kind: "error", message: "Sign in again" };
  const result = await sendAgreement(sender, text(formData, "agreementId"));
  if (!result.ok) return { kind: "error", message: result.error };
  refresh(formData);
  return { kind: "done", message: "Sent to every party for signature." };
}

export async function voidAgreementAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.SOLICITOR, Role.ADMIN);
  if (!who) return { kind: "error", message: "Sign in again" };
  const result = await voidAgreement(
    who,
    text(formData, "agreementId"),
    text(formData, "reason"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  refresh(formData);
  return { kind: "done", message: "Voided." };
}

/** Q44: Admin re-issues an expired/declined/voided agreement, or re-sends a link. */
export async function adminAgreementAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await actor(Role.ADMIN);
  if (!admin) return { kind: "error", message: "Admin access required" };
  const agreementId = text(formData, "agreementId");
  const result =
    text(formData, "intent") === "reissue"
      ? await reissueAgreement(admin, agreementId)
      : await resendSigningLink(admin, agreementId, text(formData, "profileId"));
  if (!result.ok) return { kind: "error", message: result.error };
  refresh(formData);
  return {
    kind: "done",
    message:
      text(formData, "intent") === "reissue"
        ? "Re-issued as a new version and sent."
        : "A fresh signing link was sent.",
  };
}
