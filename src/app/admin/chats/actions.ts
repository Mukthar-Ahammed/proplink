"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { resolveReport } from "@/services/chat/messages";
import { decideThreads, revokeThread } from "@/services/chat/threads";

export type ChatAdminState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function adminActor() {
  const authz = await requireRole(Role.ADMIN);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

/** Approve or reject the ticked chats (bulk queue). */
export async function decideChatsAction(
  _previous: ChatAdminState,
  formData: FormData,
): Promise<ChatAdminState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const decision = text(formData, "decision") === "REJECT" ? "REJECT" : "APPROVE";
  const result = await decideThreads(
    admin,
    formData.getAll("threadId").map(String),
    decision,
    text(formData, "reason"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/chats");
  return {
    kind: "done",
    message: `${result.decided} ${result.decided === 1 ? "chat" : "chats"} ${decision === "APPROVE" ? "authorised" : "rejected"}.`,
  };
}

export async function revokeChatAction(
  _previous: ChatAdminState,
  formData: FormData,
): Promise<ChatAdminState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const result = await revokeThread(
    admin,
    text(formData, "threadId"),
    text(formData, "reason"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/chats");
  return { kind: "done", message: "Chat closed." };
}

export async function resolveReportAction(
  _previous: ChatAdminState,
  formData: FormData,
): Promise<ChatAdminState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const result = await resolveReport(
    admin,
    text(formData, "reportId"),
    text(formData, "resolution"),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/chats");
  return { kind: "done", message: "Report resolved." };
}
