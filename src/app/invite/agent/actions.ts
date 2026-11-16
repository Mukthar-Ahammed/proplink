"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/services/admin/audit";
import {
  acceptAgentInvite,
  inspectAgentInvite,
  INVITE_MESSAGES,
} from "@/services/agents/agentInvites";
import { bridgeVerifiedUser } from "@/services/auth/supabaseAuthService";
import { db } from "@/lib/db";

export type InviteView =
  { kind: "ready"; email: string } | { kind: "problem"; message: string };

export type AcceptView =
  { kind: "success"; destination: string } | { kind: "error"; message: string };

async function requestIp(): Promise<string> {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown"
  );
}

/** Tells the invitee which email the invitation is for, or why it can't be used. */
export async function inspectInviteAction(token: unknown): Promise<InviteView> {
  const result = await inspectAgentInvite(typeof token === "string" ? token : "");
  if (!result.ok) return { kind: "problem", message: INVITE_MESSAGES[result.problem] };
  return { kind: "ready", email: result.email };
}

/**
 * Accepts the invitation, then signs the new Agent in so they land straight in
 * the Agent portal (Phase 1 Task 3).
 */
export async function acceptInviteAction(raw: unknown): Promise<AcceptView> {
  const result = await acceptAgentInvite(raw, await requestIp());
  if (!result.ok) {
    return {
      kind: "error",
      message: "problem" in result ? INVITE_MESSAGES[result.problem] : result.validation,
    };
  }

  const password =
    raw && typeof raw === "object" && "password" in raw ? String(raw.password) : "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: result.email,
    password,
  });
  if (error || !data.user) {
    // The account exists; the Agent can still sign in normally.
    return { kind: "success", destination: "/login" };
  }

  await bridgeVerifiedUser(data.user);
  const profile = await db.profile.findUnique({
    where: { id: data.user.id },
    select: { legacyUserId: true },
  });
  if (profile?.legacyUserId) {
    await writeAudit({
      actorUserId: profile.legacyUserId,
      action: "AGENT_INVITE_ACCEPTED",
      entity: "AgentInvite",
      entityId: result.inviteId,
    });
  }
  return { kind: "success", destination: "/agent" };
}
