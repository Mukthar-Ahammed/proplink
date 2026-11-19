import "server-only";

import { getServerEnv } from "@/env";
import { Role } from "@/generated/prisma/enums";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import { reserveAiBudget, settleAiBudget } from "@/services/ai/budget";
import {
  AiUnavailableError,
  DRAFT_LIMITS,
  getAiProvider,
  type ListingAssistantInput,
  type ListingDraft,
} from "@/services/ai";

/**
 * AI listing assistant (Phase 2 Task 2, ADR-036; business Q5). The Landlord
 * types short answers; the AI returns a draft the Landlord reviews and edits
 * in the listing form. Nothing is saved here and the AI never acts.
 */

export const FEATURE = "listing_assistant";
/** Per-field cap on what the Landlord types; the "anything else" box gets more. */
export const INPUT_FIELD_MAX = 300;
export const INPUT_EXTRA_MAX = 600;

export type AssistantResult =
  | { ok: true; draft: ListingDraft }
  | {
      ok: false;
      error: string;
      reason:
        "forbidden" | "empty" | "disabled" | "rate_limited" | "budget" | "unavailable";
    };

export function assistantLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 3600, limit: 10 }];
}

const CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+44\s?|\b0)(?:\d[\s-]?){9,10}\b/g;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

/** Untrusted input: strip control characters, contact details and links; cap length. */
export function cleanInputField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(CONTROL, " ")
    .replace(EMAIL, "[removed]")
    .replace(PHONE, "[removed]")
    .replace(URL, "[removed]")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Model output is shown as plain text: strip markup and cap to the column limits. */
export function cleanOutputField(value: string, max: number): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL, " ")
    .replace(/<[^>]*>/g, "")
    .replace(URL, "")
    .replace(EMAIL, "")
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/, "")
        .replace(/[*_`~]+/g, "")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
    .slice(0, max)
    .trim();
}

export function buildAssistantInput(raw: Record<string, unknown>): ListingAssistantInput {
  const kind = raw.propertyKind;
  const outcome = raw.desiredOutcome;
  return {
    propertyKind: kind === "PROPERTY" || kind === "LAND" ? kind : null,
    propertyType: cleanInputField(raw.propertyType, 60),
    location: cleanInputField(raw.location, 100),
    condition: cleanInputField(raw.condition, INPUT_FIELD_MAX),
    defects: cleanInputField(raw.defects, INPUT_FIELD_MAX),
    requiredWork: cleanInputField(raw.requiredWork, INPUT_FIELD_MAX),
    desiredOutcome:
      outcome === "REFURBISHMENT" || outcome === "DEVELOPMENT_JV" ? outcome : null,
    extra: cleanInputField(raw.extra, INPUT_EXTRA_MAX),
  };
}

/** Rough upper estimate (about 3 characters per token) plus the system prompt. */
function estimateInputTokens(input: ListingAssistantInput): number {
  const chars = Object.values(input).reduce<number>(
    (sum, value) => sum + (typeof value === "string" ? value.length : 0),
    0,
  );
  return 600 + Math.ceil(chars / 3);
}

function logUsage(fields: Record<string, unknown>) {
  // Usage only: never the Landlord's answers or the generated text.
  console.info(JSON.stringify({ event: "ai.usage", feature: FEATURE, ...fields }));
}

export async function draftListingWithAi(
  actor: { profileId: string; role: Role },
  raw: Record<string, unknown>,
): Promise<AssistantResult> {
  if (actor.role !== Role.LANDLORD) {
    return {
      ok: false,
      reason: "forbidden",
      error: "Only Landlords can use the assistant",
    };
  }
  const input = buildAssistantInput(raw);
  const answered = [input.condition, input.defects, input.requiredWork, input.extra].some(
    (value) => value.length >= 3,
  );
  if (!answered) {
    return {
      ok: false,
      reason: "empty",
      error: "Add a few words about the condition, defects or work needed first",
    };
  }

  const provider = getAiProvider();
  if (!provider) {
    return { ok: false, reason: "disabled", error: "The AI assistant is switched off" };
  }

  const allowed = await consumeRateLimits(
    "ai_listing_assistant",
    assistantLimits(actor.profileId),
  );
  if (!allowed) {
    logUsage({ outcome: "rate_limited" });
    return {
      ok: false,
      reason: "rate_limited",
      error: "You have used the assistant 10 times this hour. Try again later.",
    };
  }

  const env = getServerEnv();
  const reservation = await reserveAiBudget(
    {
      profileId: actor.profileId,
      feature: FEATURE,
      provider: provider.name,
      model: provider.model,
      reservedTokens: estimateInputTokens(input) + provider.maxOutputTokens,
    },
    {
      perUserDaily: env.AI_DAILY_TOKEN_BUDGET_PER_USER,
      globalDaily: env.AI_GLOBAL_DAILY_BUDGET,
    },
  );
  if (!reservation.ok) {
    logUsage({ outcome: "budget_exhausted", scope: reservation.scope });
    return {
      ok: false,
      reason: "budget",
      error:
        reservation.scope === "user"
          ? "You have reached today's assistant limit. You can still write the listing yourself."
          : "The assistant is busy today. You can still write the listing yourself.",
    };
  }

  try {
    const result = await provider.draftListing(input);
    await settleAiBudget(reservation.id, {
      status: "COMPLETED",
      usage: result.usage,
      model: result.model,
    });
    logUsage({
      outcome: "ok",
      provider: provider.name,
      model: result.model,
      ...result.usage,
    });
    return {
      ok: true,
      draft: {
        description: cleanOutputField(result.draft.description, DRAFT_LIMITS.description),
        defects: cleanOutputField(result.draft.defects, DRAFT_LIMITS.defects),
        requiredWork: cleanOutputField(
          result.draft.requiredWork,
          DRAFT_LIMITS.requiredWork,
        ),
      },
    };
  } catch (error) {
    const reason = error instanceof AiUnavailableError ? error.reason : "provider_error";
    const usage = error instanceof AiUnavailableError ? error.usage : undefined;
    await settleAiBudget(reservation.id, { status: "FAILED", usage });
    logUsage({ outcome: reason, provider: provider.name, ...usage });
    return {
      ok: false,
      reason: "unavailable",
      error:
        "The assistant could not write a draft just now. Please try again or write it yourself.",
    };
  }
}
