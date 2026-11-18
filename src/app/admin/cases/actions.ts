"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { requireAdminPermission } from "@/lib/authz";
import {
  addCaseEvidence,
  addCaseNote,
  assignCase,
  closeOrReopenCase,
  resolveCase,
  setCasePriority,
  setCaseStatus,
} from "@/services/admin/cases";
import { decideDataExport, requestDataExport } from "@/services/admin/dataExport";
import { db } from "@/lib/db";

/** Case and data-request actions (Phase 6 Task 3, ADR-059); rules live in the services. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function manager() {
  const authz = await requireAdminPermission("CASE_MANAGEMENT");
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

const DENIED: ProjectFormState = { kind: "error", message: "Case permission required" };

function finish(
  result: { ok: true } | { ok: false; error: string },
  paths: string[],
  message: string,
): ProjectFormState {
  if (!result.ok) return { kind: "error", message: result.error };
  for (const path of paths) revalidatePath(path);
  return { kind: "done", message };
}

export async function caseAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await manager();
  if (!admin) return DENIED;
  const caseId = text(formData, "caseId");
  const paths = ["/admin/cases", `/admin/cases/${caseId}`];
  switch (text(formData, "intent")) {
    case "assign": {
      const to = text(formData, "assigneeId");
      return finish(
        await assignCase(admin, caseId, to === "" ? null : to),
        paths,
        "Assigned.",
      );
    }
    case "take":
      return finish(
        await assignCase(admin, caseId, admin.profileId),
        paths,
        "Assigned to you.",
      );
    case "status":
      return finish(
        await setCaseStatus(admin, caseId, text(formData, "status")),
        paths,
        "Saved.",
      );
    case "priority":
      return finish(
        await setCasePriority(admin, caseId, text(formData, "priority")),
        paths,
        "Saved.",
      );
    case "note":
      return finish(
        await addCaseNote(admin, caseId, text(formData, "body")),
        paths,
        "Note added.",
      );
    case "evidence":
      return finish(
        await addCaseEvidence(admin, caseId, {
          label: text(formData, "label"),
          url: text(formData, "url"),
        }),
        paths,
        "Evidence added.",
      );
    case "resolve":
      return finish(
        await resolveCase(admin, caseId, text(formData, "resolution")),
        paths,
        "Resolved.",
      );
    case "close":
      return finish(await closeOrReopenCase(admin, caseId, true), paths, "Closed.");
    case "reopen":
      return finish(await closeOrReopenCase(admin, caseId, false), paths, "Reopened.");
    default:
      return { kind: "error", message: "Unknown action" };
  }
}

export async function dataExportAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await manager();
  if (!admin) return DENIED;
  const intent = text(formData, "intent");
  if (intent === "request") {
    const email = text(formData, "email").trim().toLowerCase();
    const user = email
      ? await db.user.findUnique({
          where: { email },
          select: { authProfile: { select: { id: true } } },
        })
      : null;
    if (!user?.authProfile)
      return { kind: "error", message: "No member with that email" };
    return finish(
      await requestDataExport(admin, {
        subjectId: user.authProfile.id,
        reason: text(formData, "reason"),
        caseId: text(formData, "caseId") || undefined,
      }),
      ["/admin/privacy"],
      "Recorded. A second case manager must approve it.",
    );
  }
  return finish(
    await decideDataExport(admin, text(formData, "requestId"), intent === "approve"),
    ["/admin/privacy"],
    intent === "approve" ? "Approved; download within 7 days." : "Rejected.",
  );
}
