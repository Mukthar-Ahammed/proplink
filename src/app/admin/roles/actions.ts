"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { requireAdminPermission } from "@/lib/authz";
import {
  cancelPermissionChange,
  decidePermissionChange,
  requestPermissionChange,
} from "@/services/admin/permissions";

/** Admin permission changes (Phase 6 Task 2, ADR-058); rules live in the service and database. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function superAdmin() {
  const authz = await requireAdminPermission("SUPER_ADMIN");
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

function finish(result: { ok: true } | { ok: false; error: string }, message: string) {
  if (!result.ok) return { kind: "error", message: result.error } as const;
  revalidatePath("/admin/roles");
  return { kind: "done", message } as const;
}

export async function requestChangeAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await superAdmin();
  if (!admin) return { kind: "error", message: "Super-admin permission required" };
  return finish(
    await requestPermissionChange(admin, {
      targetId: text(formData, "targetId"),
      permission: text(formData, "permission"),
      action: text(formData, "action"),
      reason: text(formData, "reason"),
    }),
    "Requested. A second super-admin must approve it.",
  );
}

export async function decideChangeAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await superAdmin();
  if (!admin) return { kind: "error", message: "Super-admin permission required" };
  const approve = text(formData, "decision") === "approve";
  return finish(
    await decidePermissionChange(admin, text(formData, "requestId"), approve),
    approve ? "Approved." : "Rejected.",
  );
}

export async function cancelChangeAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await superAdmin();
  if (!admin) return { kind: "error", message: "Super-admin permission required" };
  return finish(
    await cancelPermissionChange(admin, text(formData, "requestId")),
    "Cancelled.",
  );
}
