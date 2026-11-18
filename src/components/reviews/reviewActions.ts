"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { requireAdminPermission, requireUser } from "@/lib/authz";
import type { Actor } from "@/services/projects/common";
import {
  moderateReview,
  replyToReview,
  reportReview,
  resolveReport,
  submitReview,
  type ModerationDecision,
} from "@/services/reviews/reviews";

/** Review actions (Phase 5 Task 4, ADR-054); every rule is the service's. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function signedIn(): Promise<Actor | null> {
  const authz = await requireUser();
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

async function admin(): Promise<Actor | null> {
  // Phase 6 (ADR-058): review moderation is its own Admin permission.
  const authz = await requireAdminPermission("REVIEW_MODERATION");
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

function finish(
  result: { ok: true } | { ok: false; error: string },
  paths: string[],
  message: string,
): ProjectFormState {
  if (!result.ok) return { kind: "error", message: result.error };
  for (const path of paths) revalidatePath(path);
  return { kind: "done", message };
}

const SIGN_IN: ProjectFormState = { kind: "error", message: "Sign in again" };

export async function submitReviewAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await signedIn();
  if (!actor) return SIGN_IN;
  const result = await submitReview(actor, {
    contextType: text(formData, "contextType"),
    contextId: text(formData, "contextId"),
    subjectId: text(formData, "subjectId"),
    rating: text(formData, "rating"),
    body: text(formData, "body"),
  });
  return finish(
    result,
    ["/account/reviews"],
    "Thanks. An Admin checks reviews before they are published.",
  );
}

export async function replyAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await signedIn();
  if (!actor) return SIGN_IN;
  const result = await replyToReview(
    actor,
    text(formData, "reviewId"),
    text(formData, "reply"),
  );
  return finish(result, ["/account/reviews"], "Reply posted.");
}

export async function reportAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await signedIn();
  if (!actor) return SIGN_IN;
  const result = await reportReview(
    actor,
    text(formData, "reviewId"),
    text(formData, "reason"),
  );
  return finish(result, [], "Reported. An Admin will look at it.");
}

export async function moderateAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await admin();
  if (!actor) return SIGN_IN;
  const result = await moderateReview(
    actor,
    text(formData, "reviewId"),
    text(formData, "decision") as ModerationDecision,
    text(formData, "note"),
  );
  return finish(result, ["/admin/reviews"], "Saved.");
}

export async function resolveReportAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await admin();
  if (!actor) return SIGN_IN;
  const result = await resolveReport(
    actor,
    text(formData, "reportId"),
    text(formData, "hide") === "true",
    text(formData, "note"),
  );
  return finish(result, ["/admin/reviews"], "Report resolved.");
}
