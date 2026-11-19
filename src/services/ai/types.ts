import { z } from "zod";

/**
 * Listing-assistant contract (Phase 2 Task 2, ADR-036). The AI only writes
 * text for the Landlord to review; it never calls tools or reads data.
 */

/** What the Landlord typed: short answers and keywords, already cleaned. */
export interface ListingAssistantInput {
  propertyKind: "PROPERTY" | "LAND" | null;
  propertyType: string;
  location: string;
  condition: string;
  defects: string;
  requiredWork: string;
  desiredOutcome: "REFURBISHMENT" | "DEVELOPMENT_JV" | null;
  extra: string;
}

/** Output limits match the landlord_listings column limits. */
export const DRAFT_LIMITS = {
  description: 5000,
  defects: 3000,
  requiredWork: 3000,
} as const;

/** Shape the model must return (also the structured-output schema). */
export const listingDraftSchema = z.object({
  description: z.string(),
  defects: z.string(),
  requiredWork: z.string(),
});

export type ListingDraft = z.infer<typeof listingDraftSchema>;

export interface AiUsageCount {
  inputTokens: number;
  outputTokens: number;
}

export interface ListingDraftResult {
  draft: ListingDraft;
  usage: AiUsageCount;
  model: string;
}

export interface AiProvider {
  readonly name: "mock" | "anthropic";
  readonly model: string;
  /** Largest number of output tokens one call may use. */
  readonly maxOutputTokens: number;
  draftListing(input: ListingAssistantInput): Promise<ListingDraftResult>;
}

/** The provider declined or failed; nothing usable came back. */
export class AiUnavailableError extends Error {
  constructor(
    readonly reason: "refused" | "invalid_output" | "provider_error" | "truncated",
    /** Tokens the failed call still used, when the provider reported them. */
    readonly usage?: AiUsageCount,
  ) {
    super(`AI provider unavailable: ${reason}`);
    this.name = "AiUnavailableError";
  }
}
