import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/env";

const verificationResponseSchema = z.object({
  success: z.boolean(),
});

export type TurnstileVerification =
  | { ok: true; provider: "mock" | "cloudflare" }
  | { ok: false; reason: "invalid" | "unavailable" };

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<TurnstileVerification> {
  const env = getServerEnv();
  if (!env.TURNSTILE_ENABLED || env.TURNSTILE_PROVIDER === "mock") {
    if (env.NODE_ENV === "production" && env.TURNSTILE_ENABLED) {
      throw new Error("The mock Turnstile provider cannot be used in production");
    }
    return { ok: true, provider: "mock" };
  }

  if (!token || !env.TURNSTILE_SECRET_KEY) {
    return { ok: false, reason: "invalid" };
  }

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      },
    );
  } catch {
    console.error(JSON.stringify({ event: "security.turnstile_unavailable" }));
    return { ok: false, reason: "unavailable" };
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: "security.turnstile_unavailable",
        status: response.status,
      }),
    );
    return { ok: false, reason: "unavailable" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    console.error(JSON.stringify({ event: "security.turnstile_invalid_response" }));
    return { ok: false, reason: "unavailable" };
  }

  const parsed = verificationResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "security.turnstile_invalid_response" }));
    return { ok: false, reason: "unavailable" };
  }
  return parsed.data.success
    ? { ok: true, provider: "cloudflare" }
    : { ok: false, reason: "invalid" };
}
