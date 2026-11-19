import "server-only";

import { randomUUID } from "node:crypto";

import { AiUsageStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { AiUsageCount } from "@/services/ai/types";

/**
 * Daily AI token budgets (Phase 2 Task 2, ADR-036). A call first reserves its
 * worst case (estimated input plus the maximum output) under one advisory
 * lock, so concurrent calls cannot overshoot either budget. Afterwards the
 * reservation is replaced by the actual usage. Days are UTC calendar days.
 * A reservation whose process died keeps counting for that day (safe side).
 */

export interface BudgetLimits {
  perUserDaily: number;
  globalDaily: number;
}

export interface ReservationRequest {
  profileId: string;
  feature: string;
  provider: string;
  model: string;
  reservedTokens: number;
}

export type ReservationResult =
  { ok: true; id: string } | { ok: false; scope: "user" | "global" };

/** Tokens a row counts for: actual usage once known, else the reservation. */
const COUNTED = `CASE WHEN "status" = 'RESERVED' THEN "reservedTokens"
  ELSE COALESCE("inputTokens", 0) + COALESCE("outputTokens", 0) END`;

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function reserveAiBudget(
  request: ReservationRequest,
  limits: BudgetLimits,
  now: Date = new Date(),
): Promise<ReservationResult> {
  const since = startOfUtcDay(now);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('proplink:ai_budget', 0))`;
    const [totals] = await tx.$queryRawUnsafe<
      { user_tokens: bigint; all_tokens: bigint }[]
    >(
      `SELECT
         COALESCE(SUM(${COUNTED}) FILTER (WHERE "profileId" = $1::uuid), 0)::bigint AS user_tokens,
         COALESCE(SUM(${COUNTED}), 0)::bigint AS all_tokens
       FROM public.ai_usage
       WHERE "createdAt" >= $2`,
      request.profileId,
      since,
    );
    const userTokens = Number(totals?.user_tokens ?? 0);
    const allTokens = Number(totals?.all_tokens ?? 0);
    if (userTokens + request.reservedTokens > limits.perUserDaily) {
      return { ok: false, scope: "user" } as const;
    }
    if (allTokens + request.reservedTokens > limits.globalDaily) {
      return { ok: false, scope: "global" } as const;
    }
    const id = randomUUID();
    await tx.aiUsage.create({
      data: {
        id,
        profileId: request.profileId,
        feature: request.feature,
        provider: request.provider,
        model: request.model,
        reservedTokens: request.reservedTokens,
        createdAt: now,
      },
    });
    return { ok: true, id } as const;
  });
}

/** Replaces a reservation with what the call actually used. */
export async function settleAiBudget(
  id: string,
  outcome:
    | { status: "COMPLETED"; usage: AiUsageCount; model: string }
    | {
        status: "FAILED";
        usage?: AiUsageCount;
      },
): Promise<void> {
  await db.aiUsage.update({
    where: { id },
    data: {
      status:
        outcome.status === "COMPLETED" ? AiUsageStatus.COMPLETED : AiUsageStatus.FAILED,
      inputTokens: outcome.usage?.inputTokens ?? 0,
      outputTokens: outcome.usage?.outputTokens ?? 0,
      ...(outcome.status === "COMPLETED" ? { model: outcome.model.slice(0, 80) } : {}),
      completedAt: new Date(),
    },
  });
}
