import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  getServerEnv: () => ({
    AI_PROVIDER: "mock",
    AI_MODEL: "claude-opus-5-5",
    AI_DAILY_TOKEN_BUDGET_PER_USER: 40_000,
    AI_GLOBAL_DAILY_BUDGET: 1_000_000,
    NODE_ENV: "test",
  }),
}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn(),
}));
vi.mock("@/services/ai/budget", () => ({
  reserveAiBudget: vi.fn(),
  settleAiBudget: vi.fn(),
}));

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(readonly status: number) {
      super("api error");
    }
  }
  class Anthropic {
    static APIError = APIError;
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});
vi.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodOutputFormat: () => ({ type: "json_schema" }),
}));

import { Role } from "@/generated/prisma/enums";
import {
  AnthropicAiProvider,
  LISTING_SYSTEM_PROMPT,
} from "@/services/ai/anthropicAiProvider";
import { reserveAiBudget, settleAiBudget } from "@/services/ai/budget";
import {
  AiUnavailableError,
  MockAiProvider,
  setAiProviderForTests,
  type AiProvider,
} from "@/services/ai";
import {
  assistantLimits,
  buildAssistantInput,
  cleanInputField,
  cleanOutputField,
  draftListingWithAi,
} from "@/services/ai/listingAssistant";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";

const LANDLORD = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role: Role.LANDLORD,
};
const ANSWERS = {
  propertyKind: "PROPERTY",
  propertyType: "terraced house",
  location: "Leeds",
  condition: "empty for two years",
  defects: "damp in back bedroom",
  requiredWork: "new kitchen and rewire",
  desiredOutcome: "REFURBISHMENT",
  extra: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  setAiProviderForTests(new MockAiProvider());
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  vi.mocked(reserveAiBudget).mockResolvedValue({ ok: true, id: "res-1" });
  vi.mocked(settleAiBudget).mockResolvedValue();
});

describe("input cleaning (untrusted)", () => {
  it("removes contact details, links, markup and control characters, and caps length", () => {
    const cleaned = cleanInputField(
      "Call 07700 900123 or jo@example.com <script>x</script> see https://evil.test\u0000ok",
      300,
    );
    expect(cleaned).not.toMatch(/07700|example\.com|https|<|>|\u0000/);
    expect(cleaned).toContain("[removed]");
    expect(cleanInputField("a".repeat(1000), 300)).toHaveLength(300);
    expect(cleanInputField(42, 300)).toBe("");
  });

  it("keeps only known enum values", () => {
    const input = buildAssistantInput({ propertyKind: "CASTLE", desiredOutcome: "SELL" });
    expect(input.propertyKind).toBeNull();
    expect(input.desiredOutcome).toBeNull();
  });
});

describe("output cleaning", () => {
  it("strips markdown, HTML, links and emails and caps length", () => {
    const out = cleanOutputField(
      "# Heading\n- **Bold** point <b>x</b>\n1. Visit https://x.test or a@b.co",
      5000,
    );
    expect(out).toBe("Heading\nBold point x\nVisit or");
    expect(cleanOutputField("word ".repeat(2000), 100).length).toBeLessThanOrEqual(100);
  });
});

describe("draftListingWithAi", () => {
  it("returns a draft, settles the reservation with actual usage, and logs no content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await draftListingWithAi(LANDLORD, ANSWERS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.description).toContain("terraced house in Leeds");
    expect(consumeRateLimits).toHaveBeenCalledWith(
      "ai_listing_assistant",
      assistantLimits(LANDLORD.profileId),
    );
    expect(vi.mocked(reserveAiBudget).mock.calls[0][0]).toMatchObject({
      profileId: LANDLORD.profileId,
      feature: "listing_assistant",
      provider: "mock",
    });
    expect(settleAiBudget).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({ status: "COMPLETED" }),
    );
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("ai.usage");
    expect(logged).not.toMatch(/damp|Leeds|kitchen|terraced/);
    info.mockRestore();
  });

  it("is limited to 10 per hour per user", () => {
    expect(assistantLimits("p")).toEqual([
      { kind: "user", identifier: "p", windowSeconds: 3600, limit: 10 },
    ]);
  });

  it("refuses non-Landlords before doing anything", async () => {
    const result = await draftListingWithAi({ ...LANDLORD, role: Role.AGENT }, ANSWERS);
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });

  it("asks for some answers before calling the AI", async () => {
    const result = await draftListingWithAi(LANDLORD, { propertyType: "flat" });
    expect(result).toMatchObject({ ok: false, reason: "empty" });
    expect(reserveAiBudget).not.toHaveBeenCalled();
  });

  it("reports when the assistant is disabled", async () => {
    setAiProviderForTests(null);
    const result = await draftListingWithAi(LANDLORD, ANSWERS);
    expect(result).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("stops at the rate limit without reserving budget", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValue(false);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await draftListingWithAi(LANDLORD, ANSWERS);
    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(reserveAiBudget).not.toHaveBeenCalled();
  });

  it("stops when a daily budget is used up, without calling the provider", async () => {
    const provider: AiProvider = {
      name: "mock",
      model: "m",
      maxOutputTokens: 10,
      draftListing: vi.fn(),
    };
    setAiProviderForTests(provider);
    vi.mocked(reserveAiBudget).mockResolvedValue({ ok: false, scope: "global" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await draftListingWithAi(LANDLORD, ANSWERS);
    expect(result).toMatchObject({ ok: false, reason: "budget" });
    expect(provider.draftListing).not.toHaveBeenCalled();
  });

  it("records a failed call with the tokens it still used", async () => {
    const usage = { inputTokens: 500, outputTokens: 40 };
    setAiProviderForTests({
      name: "anthropic",
      model: "m",
      maxOutputTokens: 4000,
      draftListing: vi.fn().mockRejectedValue(new AiUnavailableError("refused", usage)),
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await draftListingWithAi(LANDLORD, ANSWERS);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(settleAiBudget).toHaveBeenCalledWith("res-1", { status: "FAILED", usage });
  });

  it("sanitises what the provider returns", async () => {
    setAiProviderForTests({
      name: "anthropic",
      model: "m",
      maxOutputTokens: 4000,
      draftListing: vi.fn().mockResolvedValue({
        model: "m",
        usage: { inputTokens: 1, outputTokens: 1 },
        draft: {
          description: "<img src=x onerror=alert(1)>Nice **house**",
          defects: "",
          requiredWork: "x".repeat(4000),
        },
      }),
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await draftListingWithAi(LANDLORD, ANSWERS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.description).toBe("Nice house");
    expect(result.draft.requiredWork).toHaveLength(3000);
  });
});

describe("AnthropicAiProvider", () => {
  const provider = new AnthropicAiProvider("test-key", "claude-opus-5-5");
  const usage = { input_tokens: 700, output_tokens: 300 };

  it("sends the answers as data with the server-side system prompt and fallbacks", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      model: "claude-opus-5-5",
      usage,
      parsed_output: { description: "d", defects: "", requiredWork: "" },
    });
    const result = await provider.draftListing(buildAssistantInput(ANSWERS));
    expect(result.usage).toEqual({ inputTokens: 700, outputTokens: 300 });
    const params = parse.mock.calls[0][0];
    expect(params.system).toBe(LISTING_SYSTEM_PROMPT);
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.tools).toBeUndefined();
    expect(params.messages[0].content).toMatch(
      /^<landlord_answers>[\s\S]*<\/landlord_answers>$/,
    );
  });

  it.each([
    ["refusal", "refused"],
    ["max_tokens", "truncated"],
  ])("maps stop reason %s to %s and keeps the usage", async (stop, reason) => {
    parse.mockResolvedValue({
      stop_reason: stop,
      model: "m",
      usage,
      parsed_output: null,
    });
    await expect(
      provider.draftListing(buildAssistantInput(ANSWERS)),
    ).rejects.toMatchObject({
      reason,
      usage: { inputTokens: 700, outputTokens: 300 },
    });
  });

  it("logs only the status on API errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    parse.mockRejectedValue(
      new (Anthropic.APIError as unknown as new (s: number) => Error)(529),
    );
    await expect(
      provider.draftListing(buildAssistantInput(ANSWERS)),
    ).rejects.toMatchObject({
      reason: "provider_error",
    });
    expect(String(error.mock.calls[0][0])).toBe(
      JSON.stringify({ event: "ai.provider_error", provider: "anthropic", status: 529 }),
    );
    error.mockRestore();
  });
});
