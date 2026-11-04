import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("server-only", () => ({}));

import {
  appOrigin,
  createRecoveryGrant,
  passwordSchema,
  recoveryGrantIsValid,
  signupSchema,
} from "@/services/auth/supabaseAuthService";

beforeAll(() => {
  process.env.AUTH_SECURITY_SECRET = "test-only-secret-with-at-least-32-bytes";
  process.env.APP_ORIGIN = "http://localhost:3000/untrusted-path";
});

describe("Supabase auth security primitives", () => {
  it("strips a role field supplied in the signup body", () => {
    const parsed = signupSchema.parse({
      email: "Person@Example.com",
      password: "correct horse battery staple",
      name: "Test Person",
      gdprConsent: true,
      role: "ADMIN",
    });

    expect(parsed.email).toBe("person@example.com");
    expect(parsed).not.toHaveProperty("role");
  });

  it("enforces the configured minimum and maximum password length", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("uses only the configured origin for fixed authentication redirects", () => {
    expect(appOrigin()).toBe("http://localhost:3000");
  });

  it("accepts an intact recovery grant and rejects tampering or another user", () => {
    const grant = createRecoveryGrant("11111111-1111-4111-8111-111111111111");

    expect(
      recoveryGrantIsValid(grant.value, "11111111-1111-4111-8111-111111111111"),
    ).toBe(true);
    expect(
      recoveryGrantIsValid(grant.value, "22222222-2222-4222-8222-222222222222"),
    ).toBe(false);
    expect(
      recoveryGrantIsValid(`${grant.value}tampered`, "11111111-1111-4111-8111-111111111111"),
    ).toBe(false);
  });
});
