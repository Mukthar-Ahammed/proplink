import { describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

describe("integration database safety guard", () => {
  it("skips the database integration suite when DATABASE_URL is unset", () => {
    expect(assertSafeIntegrationDatabase(undefined)).toBe(false);
  });

  it("allows a localhost database whose name contains test", () => {
    expect(
      assertSafeIntegrationDatabase(
        "postgresql://test:test@127.0.0.1:55432/proplink_test",
      ),
    ).toBe(true);
  });

  it.each([
    "postgresql://test:test@db.example.com:5432/proplink_test",
    "postgresql://test:test@localhost:5432/proplink",
    "https://localhost/proplink_test",
    "not-a-database-url",
  ])("rejects unsafe database URLs without including them in the error", (url) => {
    expect(() => assertSafeIntegrationDatabase(url)).toThrow(/DATABASE_URL must/);
    expect(() => assertSafeIntegrationDatabase(url)).toThrow(
      /No database connection was attempted/,
    );
  });
});
