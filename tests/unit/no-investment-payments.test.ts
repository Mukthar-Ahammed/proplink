import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/env")>();
  return { ...actual, getServerEnv: vi.fn(actual.getServerEnv) };
});

import { getServerEnv } from "@/env";
import { assertNoInvestmentPayments } from "@/services/projects/pledges";

/**
 * Constraint 1 / Phase 4 security specifics: no code path can create a
 * payment for investments. The pledge service re-checks the flag on every
 * write, and nothing in the project code (pledges, agreements, funds,
 * ledger) talks to a payment provider.
 */
const ROOT = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? files(full)
      : /\.(?:ts|tsx)$/.test(name)
        ? [full]
        : [];
  });
}

afterEach(() => vi.mocked(getServerEnv).mockRestore?.());

describe("no investment payments (SYNDICATE_PAYMENTS_ENABLED stays false)", () => {
  it("passes while the flag is false and throws if it were ever true", () => {
    expect(() => assertNoInvestmentPayments()).not.toThrow();
    vi.mocked(getServerEnv).mockReturnValueOnce({
      ...getServerEnv(),
      SYNDICATE_PAYMENTS_ENABLED: true as unknown as false,
    });
    expect(() => assertNoInvestmentPayments()).toThrow(
      /Investment payments are disabled/,
    );
  });

  it("keeps payment providers out of every project, pledge and ledger file", () => {
    const projectCode = [
      ...files(path.join(ROOT, "src/services/projects")),
      ...files(path.join(ROOT, "src/app/investor/projects")),
      ...files(path.join(ROOT, "src/app/agent/projects")),
      ...files(path.join(ROOT, "src/app/admin/projects")),
    ];
    expect(projectCode.length).toBeGreaterThan(5);
    const PAYMENT =
      /from\s+["'](?:stripe|@stripe\/[^"']+|@\/services\/billing\/(?:index|stripeBillingProvider|mockBillingProvider)|@\/services\/billing["'])|startCheckout|paymentIntents|checkout\.sessions|charges\.create/;
    const offenders = projectCode
      .filter((file) => PAYMENT.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("uses Stripe only for subscriptions", () => {
    const stripeUsers = files(path.join(ROOT, "src"))
      .filter((file) => !file.includes(`${path.sep}generated${path.sep}`))
      .filter((file) => /from\s+["']stripe["']/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
    for (const file of stripeUsers) {
      expect(
        file.startsWith("src/services/billing/") || file.startsWith("src/lib/stripe"),
      ).toBe(true);
    }
  });
});
