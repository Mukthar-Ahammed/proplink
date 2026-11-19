import "server-only";

import { getServerEnv } from "@/env";
import { AnthropicAiProvider } from "@/services/ai/anthropicAiProvider";
import { MockAiProvider } from "@/services/ai/mockAiProvider";
import type { AiProvider } from "@/services/ai/types";

export * from "@/services/ai/types";
export { MockAiProvider } from "@/services/ai/mockAiProvider";

let override: AiProvider | null | undefined;

/** Tests only: `null` simulates AI_PROVIDER=disabled. */
export function setAiProviderForTests(provider: AiProvider | null | undefined) {
  override = provider;
}

/** The configured provider, or null when the AI assistant is disabled. */
export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  const env = getServerEnv();
  if (env.AI_PROVIDER === "disabled") return null;
  if (env.AI_PROVIDER === "anthropic") {
    // The env schema already requires the key for this provider.
    return new AnthropicAiProvider(env.ANTHROPIC_API_KEY ?? "", env.AI_MODEL);
  }
  if (!env.ALLOW_MOCKS) {
    throw new Error("The mock AI provider cannot be used in production");
  }
  return new MockAiProvider();
}
