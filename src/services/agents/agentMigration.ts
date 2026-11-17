import "server-only";

import { z } from "zod";

import { AgentMigrationStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { effectiveCompanyStatus } from "@/services/agents/companyGate";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import { sendAgentMigrationNotice } from "@/services/email/mailer";

/**
 * Existing (pre-invite) Agents migration (Phase 1 Task 5, ADR-025, Q2):
 * "Existing agents are notified first. Once the agent's notification step is
 * completed, the Admin gives the authorisation", with no re-verification
 * beyond that. A pre-invite Agent is an AGENT profile with no accepted invite.
 */

type Actor = { profileId: string; legacyUserId: string };

/** Largest batch one bulk-notify action may email. */
export const NOTIFY_BATCH_LIMIT = 50;
/** An Agent is not re-emailed within this window. */
export const RENOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Bulk notify: 5 batches per hour per Admin. */
export function notifyLimits(adminProfileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: adminProfileId, windowSeconds: 3600, limit: 5 }];
}

export const MIGRATION_MESSAGES = {
  limited: "Too many notification batches. Try again later.",
  notPreInvite: "This account does not need migrating.",
  alreadyDone: "Your account is already confirmed.",
  terms: "You must accept the terms to continue",
} as const;

const notifySchema = z
  .object({
    profileIds: z
      .array(z.uuid())
      .min(1, "Select at least one agent")
      .max(NOTIFY_BATCH_LIMIT),
  })
  .strict();

const confirmSchema = z
  .object({
    acceptTerms: z.literal(true, { error: MIGRATION_MESSAGES.terms }),
  })
  .strict();

/** Pre-invite Agent profiles, optionally narrowed to some IDs. */
async function preInviteAgents(profileIds?: string[]) {
  return db.profile.findMany({
    where: {
      role: Role.AGENT,
      agentInvitesAccepted: { none: {} },
      ...(profileIds ? { id: { in: profileIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      active: true,
      createdAt: true,
      legacyUser: { select: { email: true, name: true } },
      agentMigration: true,
      companyCheck: { select: { result: true, override: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

// ── Admin side ────────────────────────────────────────────────────────────

export type MigrationQueueState = AgentMigrationStatus | "NOT_NOTIFIED";

export async function listMigrationQueue() {
  const agents = await preInviteAgents();
  const order: Record<MigrationQueueState, number> = {
    CONFIRMED: 0,
    NOT_NOTIFIED: 1,
    NOTIFIED: 2,
    AUTHORISED: 3,
  };
  return agents
    .map((agent) => ({
      profileId: agent.id,
      name: agent.name ?? agent.legacyUser?.name ?? "Unnamed agent",
      email: agent.legacyUser?.email ?? null,
      active: agent.active,
      state: (agent.agentMigration?.status ?? "NOT_NOTIFIED") as MigrationQueueState,
      migration: agent.agentMigration,
      companyStatus: effectiveCompanyStatus(agent.companyCheck),
    }))
    .sort((a, b) => order[a.state] - order[b.state]);
}

export type NotifyResult =
  | {
      ok: true;
      sent: number;
      skippedCooldown: number;
      skippedDone: number;
      failed: number;
    }
  | { ok: false; error: string; status: number };

/**
 * Emails the selected pre-invite Agents. Skips Agents who already confirmed or
 * were authorised, and anyone emailed in the last 24 hours. Only successful
 * sends are recorded as notified.
 */
export async function notifyExistingAgents(
  actor: Actor,
  raw: unknown,
  now = new Date(),
): Promise<NotifyResult> {
  const parsed = notifySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the selection",
      status: 400,
    };
  }
  if (
    !(await consumeRateLimits("agent_migration_notify", notifyLimits(actor.profileId)))
  ) {
    return { ok: false, error: MIGRATION_MESSAGES.limited, status: 429 };
  }

  const agents = await preInviteAgents([...new Set(parsed.data.profileIds)]);
  let sent = 0;
  let skippedCooldown = 0;
  let skippedDone = 0;
  let failed = 0;

  for (const agent of agents) {
    const migration = agent.agentMigration;
    if (migration && migration.status !== AgentMigrationStatus.NOTIFIED) {
      skippedDone += 1;
      continue;
    }
    if (
      migration?.notifiedAt &&
      now.getTime() - migration.notifiedAt.getTime() < RENOTIFY_COOLDOWN_MS
    ) {
      skippedCooldown += 1;
      continue;
    }
    const email = agent.legacyUser?.email;
    if (!email || !agent.active) {
      failed += 1;
      continue;
    }
    try {
      await sendAgentMigrationNotice({
        to: email,
        name: agent.name ?? agent.legacyUser?.name ?? "there",
      });
    } catch {
      failed += 1;
      continue;
    }
    await db.agentMigration.upsert({
      where: { profileId: agent.id },
      create: {
        profileId: agent.id,
        status: AgentMigrationStatus.NOTIFIED,
        notifiedAt: now,
        notifyCount: 1,
        lastNotifiedBy: actor.profileId,
      },
      update: {
        notifiedAt: now,
        notifyCount: { increment: 1 },
        lastNotifiedBy: actor.profileId,
      },
    });
    await writeAudit({
      actorUserId: actor.legacyUserId,
      action: "AGENT_MIGRATION_NOTIFIED",
      entity: "AgentMigration",
      entityId: agent.id,
    });
    sent += 1;
  }

  // IDs that were not pre-invite Agents (invited, other roles, unknown).
  failed += parsed.data.profileIds.length - agents.length;
  return { ok: true, sent, skippedCooldown, skippedDone, failed };
}

export type AuthoriseResult = { ok: true } | { ok: false; error: string; status: number };

/** Admin authorises a pre-invite Agent who has confirmed. */
export async function authoriseExistingAgent(
  actor: Actor,
  rawProfileId: unknown,
): Promise<AuthoriseResult> {
  const parsed = z.uuid().safeParse(rawProfileId);
  if (!parsed.success) return { ok: false, error: "Agent not found", status: 404 };

  const result = await db.agentMigration.updateMany({
    where: { profileId: parsed.data, status: AgentMigrationStatus.CONFIRMED },
    data: {
      status: AgentMigrationStatus.AUTHORISED,
      authorisedAt: new Date(),
      authorisedBy: actor.profileId,
    },
  });
  if (result.count === 0) {
    return {
      ok: false,
      error: "Only an agent who has confirmed their account can be authorised",
      status: 409,
    };
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "AGENT_MIGRATION_AUTHORISED",
    entity: "AgentMigration",
    entityId: parsed.data,
  });
  return { ok: true };
}

// ── Agent side ────────────────────────────────────────────────────────────

export type AgentAccessState =
  | { kind: "no_profile" }
  | { kind: "invited" }
  | { kind: "authorised" }
  | { kind: "needs_confirmation"; notified: boolean }
  | { kind: "awaiting_authorisation" };

/** Where the signed-in Agent is in onboarding; by server-verified profile ID. */
export async function getAgentAccessState(profileId: string): Promise<AgentAccessState> {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: {
      agentInvitesAccepted: { select: { id: true }, take: 1 },
      agentMigration: { select: { status: true } },
    },
  });
  if (!profile) return { kind: "no_profile" };
  if (profile.agentInvitesAccepted.length > 0) return { kind: "invited" };
  switch (profile.agentMigration?.status) {
    case AgentMigrationStatus.AUTHORISED:
      return { kind: "authorised" };
    case AgentMigrationStatus.CONFIRMED:
      return { kind: "awaiting_authorisation" };
    case AgentMigrationStatus.NOTIFIED:
      return { kind: "needs_confirmation", notified: true };
    default:
      return { kind: "needs_confirmation", notified: false };
  }
}

/**
 * Gate for Agent features added from Phase 1 onwards ("until authorised their
 * access to new features is restricted"): invited Agents and authorised
 * pre-invite Agents pass. Phase 3 chat, subscriptions and publishing to
 * investors call this. Existing features (listings, leads) are unaffected.
 */
export async function hasNewFeatureAccess(profileId: string): Promise<boolean> {
  const state = await getAgentAccessState(profileId);
  return state.kind === "invited" || state.kind === "authorised";
}

export type ConfirmMigrationResult =
  { ok: true } | { ok: false; error: string; status: number };

/** The pre-invite Agent confirms their account (Q2 "notification step"). */
export async function confirmExistingAgent(
  actor: Actor,
  raw: unknown,
): Promise<ConfirmMigrationResult> {
  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? MIGRATION_MESSAGES.terms,
      status: 400,
    };
  }

  const state = await getAgentAccessState(actor.profileId);
  if (state.kind === "invited" || state.kind === "no_profile") {
    return { ok: false, error: MIGRATION_MESSAGES.notPreInvite, status: 409 };
  }
  if (state.kind === "authorised" || state.kind === "awaiting_authorisation") {
    return { ok: false, error: MIGRATION_MESSAGES.alreadyDone, status: 409 };
  }

  const now = new Date();
  await db.agentMigration.upsert({
    where: { profileId: actor.profileId },
    create: {
      profileId: actor.profileId,
      status: AgentMigrationStatus.CONFIRMED,
      confirmedAt: now,
    },
    update: { status: AgentMigrationStatus.CONFIRMED, confirmedAt: now },
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "AGENT_MIGRATION_CONFIRMED",
    entity: "AgentMigration",
    entityId: actor.profileId,
    meta: { termsAccepted: true },
  });
  return { ok: true };
}
