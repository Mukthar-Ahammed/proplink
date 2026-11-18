"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import type { Actor } from "@/services/projects/common";
import { markProjectSold } from "@/services/projects/relist";
import {
  confirmSale,
  decideCorrection,
  proposeCorrection,
  settleProject,
} from "@/services/projects/settlement";

/** Sale and ledger actions (Phase 4 Task 8, ADR-050); rules live in the service. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function actor(...roles: Role[]): Promise<Actor | null> {
  const authz = await requireRole(...roles);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

function finish(
  formData: FormData,
  result: { ok: true } | { ok: false; error: string },
  message: string,
): ProjectFormState {
  if (!result.ok) return { kind: "error", message: result.error };
  const path = text(formData, "path");
  if (path.startsWith("/") && !path.startsWith("//")) revalidatePath(path);
  return { kind: "done", message };
}

export async function recordSaleAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.AGENT);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    // Phase 5 Task 1a: the sale record and the listing marked SOLD together.
    await markProjectSold(who, text(formData, "projectId"), {
      salePrice: text(formData, "salePrice"),
      soldOn: text(formData, "soldOn"),
    }),
    "Sale recorded; the Solicitor confirms it.",
  );
}

export async function confirmSaleAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.SOLICITOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await confirmSale(who, text(formData, "projectId")),
    "Sale confirmed.",
  );
}

export async function settleAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.SOLICITOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  const loss = Object.fromEntries(
    [...formData.entries()]
      .filter(([key]) => key.startsWith("loss:"))
      .map(([key, value]) => [key.slice("loss:".length), String(value)]),
  );
  return finish(
    formData,
    await settleProject(who, text(formData, "projectId"), loss),
    "Settled. The ledger and statements are ready.",
  );
}

export async function proposeCorrectionAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.SOLICITOR);
  if (!who) return { kind: "error", message: "Sign in again" };
  return finish(
    formData,
    await proposeCorrection(who, text(formData, "entryId"), {
      amount: text(formData, "amount"),
      reason: text(formData, "reason"),
    }),
    "Correction proposed; Admin approves it.",
  );
}

export async function decideCorrectionAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const who = await actor(Role.ADMIN);
  if (!who) return { kind: "error", message: "Admin access required" };
  const approve = text(formData, "decision") === "approve";
  return finish(
    formData,
    await decideCorrection(
      who,
      text(formData, "correctionId"),
      approve,
      text(formData, "note"),
    ),
    approve ? "Approved; the adjusting entry is in the ledger." : "Rejected.",
  );
}
