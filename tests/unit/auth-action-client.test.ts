import { describe, expect, it } from "vitest";

import {
  AUTH_ACTION_UNAVAILABLE_COOLDOWN_SECONDS,
  AUTH_ACTION_UNAVAILABLE_MESSAGE,
  runAuthAction,
} from "@/lib/security/auth-action-client";

describe("runAuthAction", () => {
  it("returns the action result unchanged when the action answers", async () => {
    const result = await runAuthAction(async () => ({
      kind: "error" as const,
      message: "Invalid email or password",
    }));
    expect(result).toEqual({ kind: "error", message: "Invalid email or password" });
  });

  it("turns a rejected call (e.g. a proxy 429) into a generic limited result", async () => {
    const result = await runAuthAction(async () => {
      throw new Error("An unexpected response was received from the server.");
    });
    expect(result).toEqual({
      kind: "limited",
      message: AUTH_ACTION_UNAVAILABLE_MESSAGE,
      cooldownSeconds: AUTH_ACTION_UNAVAILABLE_COOLDOWN_SECONDS,
    });
  });

  it("does not reveal whether an account exists", () => {
    expect(AUTH_ACTION_UNAVAILABLE_MESSAGE).not.toMatch(/account|email|password|exist/i);
  });
});
