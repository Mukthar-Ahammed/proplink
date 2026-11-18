"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import type { Actor } from "@/services/projects/common";
import { respondToNomination } from "@/services/projects/lead";
import { expressInterest, withdrawInterest } from "@/services/projects/projects";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function investorActor(): Promise<Actor | null> {
  const authz = await requireRole(Role.INVESTOR);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

/** Express or withdraw interest (the pool the Lead is nominated from). */
export async function interestAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const investor = await investorActor();
  if (!investor) return { kind: "error", message: "Sign in as an Investor" };
  const projectId = text(formData, "projectId");
  const withdraw = text(formData, "intent") === "withdraw";
  const result = withdraw
    ? await withdrawInterest(investor, projectId)
    : await expressInterest(investor, projectId);
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/investor/projects/${projectId}`);
  return {
    kind: "done",
    message: withdraw
      ? "Interest withdrawn."
      : "Interest registered. The agent can see it.",
  };
}

/** The nominee accepts or declines the Lead Investor nomination (OD-13). */
export async function nominationResponseAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const investor = await investorActor();
  if (!investor) return { kind: "error", message: "Sign in as an Investor" };
  const accept = text(formData, "intent") === "accept";
  const result = await respondToNomination(
    investor,
    text(formData, "nominationId"),
    accept,
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/investor/projects/${text(formData, "projectId")}`);
  return {
    kind: "done",
    message: accept
      ? "Accepted. PropLink will review and confirm you as Lead."
      : "Declined.",
  };
}
