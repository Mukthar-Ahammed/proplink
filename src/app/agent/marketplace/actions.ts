"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import {
  answerQuestion,
  submitProposal,
  withdrawProposal,
  type AgentActor,
} from "@/services/landlord/marketplace";

export type ProposalState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function agentActor(): Promise<AgentActor | null> {
  const authz = await requireRole(Role.AGENT);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

/** Send or update the Agent's structured proposal (Phase 2 Task 5). */
export async function submitProposalAction(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const listingId = text(formData, "listingId");
  const result = await submitProposal(agent, listingId, {
    valuation: text(formData, "valuation"),
    feeType: text(formData, "feeType"),
    feePercent: text(formData, "feePercent"),
    feeAmount: text(formData, "feeAmount"),
    contractMonths: text(formData, "contractMonths"),
    terms: text(formData, "terms"),
    pitch: text(formData, "pitch"),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/agent/marketplace/${listingId}`);
  revalidatePath("/agent/marketplace");
  return {
    kind: "done",
    message: result.data.created ? "Proposal sent to the Landlord." : "Proposal updated.",
  };
}

export async function withdrawProposalAction(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const result = await withdrawProposal(agent, text(formData, "proposalId"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/agent/marketplace/${text(formData, "listingId")}`);
  return { kind: "done", message: "Proposal withdrawn. You can send it again later." };
}

export async function answerQuestionAction(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const result = await answerQuestion(
    agent,
    text(formData, "questionId"),
    text(formData, "answer"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/agent/marketplace/${text(formData, "listingId")}`);
  return { kind: "done", message: "Answer sent." };
}
