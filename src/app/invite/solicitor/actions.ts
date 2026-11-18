"use server";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/services/admin/audit";
import { bridgeVerifiedUser } from "@/services/auth/supabaseAuthService";
import {
  acceptSolicitorInvite,
  inspectSolicitorInvite,
  SOLICITOR_INVITE_MESSAGES,
} from "@/services/projects/solicitors";

export type SolicitorInviteView =
  | { kind: "ready"; email: string; projectTitle: string }
  | { kind: "problem"; message: string };

export type SolicitorAcceptView =
  { kind: "success"; destination: string } | { kind: "error"; message: string };

async function requestIp(): Promise<string> {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown"
  );
}

export async function inspectSolicitorInviteAction(
  token: unknown,
): Promise<SolicitorInviteView> {
  const result = await inspectSolicitorInvite(typeof token === "string" ? token : "");
  if (!result.ok) {
    return { kind: "problem", message: SOLICITOR_INVITE_MESSAGES[result.problem] };
  }
  return { kind: "ready", email: result.email, projectTitle: result.projectTitle };
}

/**
 * Accepts the invitation and signs the Solicitor in. MFA enrolment is
 * mandatory (ADR-030), so they land on /mfa before the Solicitor portal.
 */
export async function acceptSolicitorInviteAction(
  raw: unknown,
): Promise<SolicitorAcceptView> {
  const result = await acceptSolicitorInvite(raw, await requestIp());
  if (!result.ok) {
    return {
      kind: "error",
      message:
        "problem" in result
          ? SOLICITOR_INVITE_MESSAGES[result.problem]
          : result.validation,
    };
  }
  const password =
    raw && typeof raw === "object" && "password" in raw ? String(raw.password) : "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: result.email,
    password,
  });
  if (error || !data.user) return { kind: "success", destination: "/login" };
  await bridgeVerifiedUser(data.user);
  const profile = await db.profile.findUnique({
    where: { id: data.user.id },
    select: { legacyUserId: true },
  });
  if (profile?.legacyUserId) {
    await writeAudit({
      actorUserId: profile.legacyUserId,
      action: "PROJECT_SOLICITOR_ACCEPTED",
      entity: "InvestorProject",
      entityId: result.projectId,
      meta: { solicitorId: result.solicitorId },
    });
  }
  return { kind: "success", destination: "/mfa" };
}
