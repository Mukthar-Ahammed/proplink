"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { ensureProjectThread } from "@/services/chat/threads";
import { resolveCoInvestorAlias, toggleFavourite } from "@/services/projects/community";
import type { Actor } from "@/services/projects/common";
import { respondToNomination } from "@/services/projects/lead";
import { cancelPledge, createPledge } from "@/services/projects/pledges";
import { formatPounds } from "@/services/projects/shares";
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

/** Phase 4 Task 4: pledge (expression of interest until signed). */
export async function pledgeAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const investor = await investorActor();
  if (!investor) return { kind: "error", message: "Sign in as an Investor" };
  const projectId = text(formData, "projectId");
  const result = await createPledge(
    investor,
    projectId,
    text(formData, "amount"),
    text(formData, "idempotencyKey"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/investor/projects/${projectId}`);
  return {
    kind: "done",
    message: `Pledged ${formatPounds(result.data.amountGBP)}: your share is ${result.data.share}.`,
  };
}

export async function cancelPledgeAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const investor = await investorActor();
  if (!investor) return { kind: "error", message: "Sign in as an Investor" };
  const result = await cancelPledge(investor, text(formData, "pledgeId"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/investor/projects/${text(formData, "projectId")}`);
  return { kind: "done", message: "Pledge cancelled." };
}

/** Task 3: save or unsave a project. */
export async function favouriteAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const investor = await investorActor();
  if (!investor) return { kind: "error", message: "Sign in as an Investor" };
  const projectId = text(formData, "projectId");
  const result = await toggleFavourite(investor, projectId);
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/investor/projects/${projectId}`);
  revalidatePath("/investor/projects");
  return { kind: "done", message: result.data.favourite ? "Saved." : "Removed." };
}

/** Task 3: ask PropLink to open a chat with the project's Agent or Lead (Admin authorises). */
export async function projectChatAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const investor = await investorActor();
  if (!investor) return { kind: "error", message: "Sign in as an Investor" };
  const withWhom = text(formData, "with");
  const projectId = text(formData, "projectId");
  let target: "agent" | "lead" | { investorId: string };
  if (withWhom === "agent" || withWhom === "lead") {
    target = withWhom;
  } else {
    // The Lead picks a co-investor by alias, never by account id (ADR-079).
    const investorId = await resolveCoInvestorAlias(
      investor,
      projectId,
      text(formData, "coInvestor"),
    );
    if (!investorId)
      return { kind: "error", message: "That co-investor is not on this project" };
    target = { investorId };
  }
  const result = await ensureProjectThread(investor, projectId, target);
  if (!result.ok) return { kind: "error", message: result.error };
  redirect(`/messages/${result.threadId}`);
}
