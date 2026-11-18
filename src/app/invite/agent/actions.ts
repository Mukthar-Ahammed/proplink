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
import {
  confirmCompany,
  searchCompaniesForInvite,
  type SearchResult,
} from "@/services/agents/companyCheck";

export type InviteView =
  { kind: "ready"; email: string } | { kind: "problem"; message: string };

export type AcceptView =
  | { kind: "success"; destination: string; companyChecked: boolean }
  | { kind: "error"; message: string };

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
 * Company search on the invite page (business Q1: the company is checked on
 * acceptance). Only for a valid, unexpired invitation; rate-limited per IP.
 */
export async function searchCompanyForInviteAction(
  token: unknown,
  query: unknown,
): Promise<SearchResult> {
  const invite = await inspectAgentInvite(typeof token === "string" ? token : "");
  if (!invite.ok) return { ok: false, error: INVITE_MESSAGES[invite.problem] };
  return searchCompaniesForInvite(await requestIp(), query);
}

/**
 * Accepts the invitation, signs the new Agent in so they land straight in the
 * Agent portal (Phase 1 Task 3), and records their company from Companies
 * House (business Q1). If the register can't be reached, the account is still
 * created and the dashboard asks them to finish the company check.
 */
export async function acceptInviteAction(raw: unknown): Promise<AcceptView> {
  const companyNumber =
    raw && typeof raw === "object" && "companyNumber" in raw
      ? (raw as { companyNumber: unknown }).companyNumber
      : undefined;
  const acceptInput =
    raw && typeof raw === "object"
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "companyNumber"))
      : raw;
  const result = await acceptAgentInvite(acceptInput, await requestIp());
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
    return { kind: "success", destination: "/login", companyChecked: false };
  }

  await bridgeVerifiedUser(data.user);
  const profile = await db.profile.findUnique({
    where: { id: data.user.id },
    select: { legacyUserId: true },
  });
  let companyChecked = false;
  if (profile?.legacyUserId) {
    await writeAudit({
      actorUserId: profile.legacyUserId,
      action: "AGENT_INVITE_ACCEPTED",
      entity: "AgentInvite",
      entityId: result.inviteId,
    });
    if (typeof companyNumber === "string" && companyNumber.length > 0) {
      // The server looks the company up again; nothing from the browser is trusted.
      const check = await confirmCompany(
        { profileId: data.user.id, legacyUserId: profile.legacyUserId },
        companyNumber,
      );
      companyChecked = check.ok;
    }
  }
  return { kind: "success", destination: "/agent", companyChecked };
}
