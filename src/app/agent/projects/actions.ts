"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { announceSafely, type Actor } from "@/services/projects/common";
import { ensureProjectThread } from "@/services/chat/threads";
import { nominateLead, withdrawNomination } from "@/services/projects/lead";
import {
  announceProject,
  publishProject,
  updateProjectTerms,
} from "@/services/projects/projects";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function agentActor(): Promise<Actor | null> {
  const authz = await requireRole(Role.AGENT);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

const TERMS = [
  "title",
  "summary",
  "mode",
  "capitalRequired",
  "minimumPledge",
  "fundingDeadline",
  "purchase",
  "marketValue",
  "expectedProfit",
  "expectedMonths",
] as const;

function termsFrom(formData: FormData) {
  return Object.fromEntries(TERMS.map((key) => [key, text(formData, key)]));
}

/** Phase 4 Task 1: publish from an active mandate. */
export async function publishProjectAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const result = await publishProject(
    agent,
    text(formData, "mandateId"),
    termsFrom(formData),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  const { projectId } = result.data;
  after(() => announceSafely(() => announceProject(projectId)));
  revalidatePath("/agent/projects");
  redirect(`/agent/projects/${projectId}`);
}

export async function updateProjectAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const projectId = text(formData, "projectId");
  const result = await updateProjectTerms(agent, projectId, termsFrom(formData));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/agent/projects/${projectId}`);
  return { kind: "done", message: "Saved." };
}

/** Phase 4 Task 2 (OD-13): nominate or withdraw the Lead Investor. */
export async function leadNominationAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const projectId = text(formData, "projectId");
  const result =
    text(formData, "intent") === "withdraw"
      ? await withdrawNomination(agent, text(formData, "nominationId"))
      : await nominateLead(agent, projectId, text(formData, "investorId"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/agent/projects/${projectId}`);
  return {
    kind: "done",
    message:
      text(formData, "intent") === "withdraw"
        ? "Nomination withdrawn."
        : "Nominated. The investor accepts, then PropLink approves.",
  };
}

/** Task 3: ask PropLink to open a chat with one of the project's investors. */
export async function agentProjectChatAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const result = await ensureProjectThread(agent, text(formData, "projectId"), {
    investorId: text(formData, "investorId"),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  redirect(`/messages/${result.threadId}`);
}
