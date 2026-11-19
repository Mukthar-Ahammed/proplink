import type {
  AiProvider,
  ListingAssistantInput,
  ListingDraftResult,
} from "@/services/ai/types";

/**
 * Local-development provider: builds a plain draft from the Landlord's own
 * answers, deterministically, with no network call. Refused in production.
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly model = "mock-listing-assistant";
  readonly maxOutputTokens = 800;

  async draftListing(input: ListingAssistantInput): Promise<ListingDraftResult> {
    const kind = input.propertyKind === "LAND" ? "plot of land" : "property";
    const type = input.propertyType || kind;
    const where = input.location ? ` in ${input.location}` : "";
    const outcome =
      input.desiredOutcome === "DEVELOPMENT_JV"
        ? "The owner is open to a development joint venture."
        : input.desiredOutcome === "REFURBISHMENT"
          ? "The owner is looking for a refurbishment partner."
          : "";
    const description = [
      `[Mock draft] A ${type}${where} offered privately to verified agents.`,
      input.condition ? `Condition: ${input.condition}.` : "",
      input.extra ? `Further details: ${input.extra}.` : "",
      outcome,
    ]
      .filter(Boolean)
      .join(" ");
    const draft = {
      description,
      defects: input.defects ? `Reported defects: ${input.defects}.` : "",
      requiredWork: input.requiredWork ? `Work needed: ${input.requiredWork}.` : "",
    };
    const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
    return {
      draft,
      model: this.model,
      usage: {
        inputTokens: 200 + words(Object.values(input).join(" ")),
        outputTokens: words(Object.values(draft).join(" ")),
      },
    };
  }
}
