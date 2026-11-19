"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { announceReturnToPool, announceSafely } from "@/services/landlord/announcements";
import { redirect } from "next/navigation";

import { LandlordListingFileKind, Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { draftListingWithAi, type AssistantResult } from "@/services/ai/listingAssistant";
import {
  attachFile,
  createDraft,
  deleteOwnDraft,
  detachOwnFile,
  submitOwnListing,
  updateOwnListing,
  withdrawOwnListing,
  type LandlordActor,
} from "@/services/landlord/listings";
import { askQuestion, declineProposal } from "@/services/landlord/marketplace";
import {
  attachContract,
  chooseAgent,
  closeMandate,
  terminateMandate,
  withdrawOffer,
} from "@/services/landlord/mandates";

export type FormState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "saved" };

async function landlord(): Promise<LandlordActor | null> {
  const authz = await requireRole(Role.LANDLORD);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return {
    profileId: user.authUserId,
    legacyUserId: user.id,
    role: user.role,
    kycStatus: user.kycStatus,
  };
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

function fieldsFrom(formData: FormData) {
  const kind = text(formData, "propertyKind");
  const outcome = text(formData, "desiredOutcome");
  const area = text(formData, "landAreaSqm").trim();
  return {
    title: text(formData, "title"),
    addressLine1: text(formData, "addressLine1"),
    city: text(formData, "city"),
    postcode: text(formData, "postcode"),
    propertyKind: kind || null,
    propertyType: text(formData, "propertyType"),
    description: text(formData, "description"),
    defects: text(formData, "defects"),
    requiredWork: text(formData, "requiredWork"),
    landAreaSqm: area ? area : null,
    desiredOutcome: outcome || null,
  };
}

export async function createListingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const result = await createDraft(actor, {
    title: text(formData, "title"),
    propertyKind: text(formData, "propertyKind") || null,
  });
  if (!result.ok) return { kind: "error", message: result.error };
  redirect(`/landlord/listings/${result.data.id}`);
}

export async function saveListingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const id = text(formData, "id");
  const result = await updateOwnListing(actor, id, fieldsFrom(formData));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/landlord/listings/${id}`);
  return { kind: "saved" };
}

/** Called after a successful upload through the secure pipeline. */
export async function attachFileAction(
  listingId: string,
  fileId: string,
  kind: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await landlord();
  if (!actor) return { ok: false, error: "Sign in as a Landlord" };
  const result = await attachFile(
    actor,
    listingId,
    fileId,
    kind as LandlordListingFileKind,
    {
      ownerId: actor.profileId,
    },
  );
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/landlord/listings/${listingId}`);
  return { ok: true };
}

export async function detachFileAction(formData: FormData): Promise<void> {
  const actor = await landlord();
  if (!actor) return;
  const listingId = text(formData, "listingId");
  await detachOwnFile(actor, listingId, text(formData, "fileId"));
  revalidatePath(`/landlord/listings/${listingId}`);
}

export async function submitListingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const id = text(formData, "id");
  const result = await submitOwnListing(actor, id);
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/landlord/listings/${id}`);
  revalidatePath("/landlord");
  return { kind: "saved" };
}

export async function withdrawListingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const id = text(formData, "id");
  const result = await withdrawOwnListing(actor, id);
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/landlord/listings/${id}`);
  revalidatePath("/landlord");
  return { kind: "saved" };
}

export async function deleteDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const result = await deleteOwnDraft(actor, text(formData, "id"));
  if (!result.ok) return { kind: "error", message: result.error };
  redirect("/landlord/listings");
}

/** Structured question on an Agent's proposal (Phase 2 Task 5; not chat). */
export async function askQuestionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const result = await askQuestion(
    actor,
    text(formData, "proposalId"),
    text(formData, "question"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/landlord/listings/${text(formData, "listingId")}/proposals`);
  return { kind: "saved" };
}

export async function declineProposalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const result = await declineProposal(actor, text(formData, "proposalId"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/landlord/listings/${text(formData, "listingId")}/proposals`);
  return { kind: "saved" };
}

/**
 * AI listing assistant: returns a draft for the Landlord to review. Nothing
 * is saved; the Landlord puts the draft into the form and saves as usual.
 */
export async function draftWithAiAction(raw: unknown): Promise<AssistantResult> {
  const actor = await landlord();
  if (!actor) {
    return { ok: false, reason: "forbidden", error: "Sign in as a Landlord" };
  }
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return draftListingWithAi(actor, input);
}

// ── Exclusive mandate (Phase 2 Task 6) ──────────────────────────────────

function refreshMandatePages(formData: FormData) {
  const listingId = text(formData, "listingId");
  revalidatePath(`/landlord/listings/${listingId}/proposals`);
  revalidatePath(`/landlord/listings/${listingId}`);
  revalidatePath("/landlord");
}

/** Choose one Agent: offers them the exclusive mandate. */
export async function chooseAgentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const result = await chooseAgent(actor, text(formData, "proposalId"), {
    renewalTerms: text(formData, "renewalTerms"),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  refreshMandatePages(formData);
  return { kind: "saved" };
}

/** Withdraw an unanswered offer, close at contract end, or terminate with a reason. */
export async function mandateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await landlord();
  if (!actor) return { kind: "error", message: "Sign in as a Landlord" };
  const mandateId = text(formData, "mandateId");
  const intent = text(formData, "intent");
  const result =
    intent === "withdraw"
      ? await withdrawOffer(actor, mandateId)
      : intent === "close"
        ? await closeMandate(actor, mandateId)
        : await terminateMandate(actor, mandateId, text(formData, "reason"));
  if (!result.ok) return { kind: "error", message: result.error };
  if (intent !== "withdraw") {
    // Task 8 / Q9: the listing is back in the pool; tell verified Agents.
    after(() => announceSafely(() => announceReturnToPool(mandateId)));
  }
  refreshMandatePages(formData);
  return { kind: "saved" };
}

/** Called after the contract was uploaded through the secure pipeline. */
export async function attachMandateContractAction(
  mandateId: string,
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await landlord();
  if (!actor) return { ok: false, error: "Sign in as a Landlord" };
  const result = await attachContract(actor, mandateId, fileId);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
