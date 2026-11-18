"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { announceSafely, type Actor } from "@/services/projects/common";
import { hideProjectQuestion } from "@/services/projects/community";
import {
  endSolicitor,
  inviteSolicitor,
  resendSolicitorInvite,
} from "@/services/projects/solicitors";
import { announceProjectOpen, decideNomination } from "@/services/projects/lead";
import { announceProject, publishProject } from "@/services/projects/projects";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function adminActor(): Promise<Actor | null> {
  const authz = await requireRole(Role.ADMIN);
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

/** TRD matrix: Admin publishes on the mandated Agent's behalf, audited. */
export async function adminPublishProjectAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const result = await publishProject(
    admin,
    text(formData, "mandateId"),
    Object.fromEntries(TERMS.map((key) => [key, text(formData, key)])),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  const { projectId } = result.data;
  after(() => announceSafely(() => announceProject(projectId)));
  revalidatePath("/admin/projects");
  redirect(`/admin/projects/${projectId}`);
}

/** OD-13: approve or reject an accepted Lead nomination. */
export async function decideNominationAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const approve = text(formData, "decision") === "approve";
  const result = await decideNomination(
    admin,
    text(formData, "nominationId"),
    approve,
    text(formData, "reason"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  const projectId = text(formData, "projectId");
  if (approve) after(() => announceSafely(() => announceProjectOpen(projectId)));
  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${projectId}`);
  return {
    kind: "done",
    message: approve ? "Lead confirmed; the project is open for pledges." : "Rejected.",
  };
}

/** Task 3: moderate the project Q&A. */
export async function hideQuestionAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const result = await hideProjectQuestion(
    admin,
    text(formData, "questionId"),
    text(formData, "reason"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/admin/projects/${text(formData, "projectId")}`);
  return { kind: "done", message: "Hidden." };
}

/** Task 5: appoint, re-invite or end the project's Solicitor (audited). */
export async function solicitorAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const projectId = text(formData, "projectId");
  const intent = text(formData, "intent");
  if (intent === "end") {
    const ended = await endSolicitor(
      admin,
      text(formData, "solicitorId"),
      text(formData, "reason"),
    );
    if (!ended.ok) return { kind: "error", message: ended.error };
    revalidatePath(`/admin/projects/${projectId}`);
    return { kind: "done", message: "Ended." };
  }
  const result =
    intent === "invite"
      ? await inviteSolicitor(admin, projectId, {
          email: text(formData, "email"),
          name: text(formData, "name"),
          firm: text(formData, "firm"),
        })
      : await resendSolicitorInvite(admin, text(formData, "solicitorId"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/admin/projects/${projectId}`);
  const link = result.data.devInviteUrl
    ? ` Development link: ${result.data.devInviteUrl}`
    : "";
  return {
    kind: "done",
    message: result.data.emailed
      ? `Invitation sent.${link}`
      : `Saved, but the email could not be sent; use Re-send.${link}`,
  };
}
