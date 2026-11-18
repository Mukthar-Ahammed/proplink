"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import type { Actor } from "@/services/projects/common";
import { recordDecision } from "@/services/projects/decisions";
import {
  addMilestone,
  advanceProject,
  decideChange,
  postProjectUpdate,
  recordChange,
  recordCost,
  recordFundStatus,
  setMilestoneStatus,
  voidCost,
} from "@/services/projects/works";

/**
 * Works actions (Phase 4 Task 7, ADR-049). Each resolves the signed-in actor
 * (role and MFA checks); every project rule is the service's.
 */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function actor(...roles: Role[]): Promise<Actor | null> {
  const authz = await requireRole(...roles);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

function done(formData: FormData, message: string): ProjectFormState {
  const path = text(formData, "path");
  if (path.startsWith("/") && !path.startsWith("//")) revalidatePath(path);
  return { kind: "done", message };
}

type Result = { ok: true } | { ok: false; error: string };
const finish = (formData: FormData, result: Result, message: string): ProjectFormState =>
  result.ok ? done(formData, message) : { kind: "error", message: result.error };

export async function fundStatusAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.SOLICITOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await recordFundStatus(who, text(formData, "pledgeId"), {
      status: text(formData, "status"),
      received: text(formData, "received"),
      note: text(formData, "note"),
    }),
    "Funds status recorded.",
  );
}

export async function costAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.AGENT, Role.SOLICITOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await recordCost(who, text(formData, "projectId"), {
      category: text(formData, "category"),
      description: text(formData, "description"),
      amount: text(formData, "amount"),
      incurredOn: text(formData, "incurredOn"),
    }),
    "Cost recorded.",
  );
}

export async function voidCostAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.AGENT, Role.SOLICITOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await voidCost(who, text(formData, "costId"), text(formData, "reason")),
    "Cost voided.",
  );
}

export async function milestoneAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.AGENT);
  if (!who) return { kind: "error", message: "Sign in again" };
  const milestoneId = text(formData, "milestoneId");
  const result = milestoneId
    ? await setMilestoneStatus(who, milestoneId, text(formData, "status"))
    : await addMilestone(who, text(formData, "projectId"), {
        title: text(formData, "title"),
        dueOn: text(formData, "dueOn"),
      });
  return finish(formData, result, "Saved.");
}

export async function updateAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.AGENT, Role.SOLICITOR, Role.ADMIN);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await postProjectUpdate(who, text(formData, "projectId"), {
      title: text(formData, "title"),
      body: text(formData, "body"),
      audience: text(formData, "audience") || undefined,
    }),
    "Update posted.",
  );
}

export async function changeAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.SOLICITOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await recordChange(who, text(formData, "projectId"), {
      kind: text(formData, "kind"),
      summary: text(formData, "summary"),
      budgetDelta: text(formData, "budgetDelta"),
      newCompletionOn: text(formData, "newCompletionOn"),
    }),
    "Change recorded; the Lead Investor decides it.",
  );
}

export async function decideChangeAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.INVESTOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  const approve = text(formData, "decision") === "approve";
  return finish(
    formData,
    await decideChange(who, text(formData, "changeId"), approve, text(formData, "note")),
    approve ? "Approved." : "Rejected.",
  );
}

export async function advanceAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.AGENT);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await advanceProject(who, text(formData, "projectId"), text(formData, "to")),
    "Project moved on.",
  );
}

/** Task 9 (Q44): extend the deadline, close the project or release unsigned pledges. */
export async function decisionAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.AGENT, Role.ADMIN);
  if (!who) return { kind: "error", message: "Sign in again" };
  const result = await recordDecision(who, text(formData, "projectId"), {
    kind: text(formData, "kind"),
    reason: text(formData, "reason"),
    newDeadline: text(formData, "newDeadline"),
  });
  return finish(formData, result, "Decision recorded.");
}
