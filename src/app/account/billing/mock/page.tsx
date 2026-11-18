import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isMockBillingAvailable } from "@/services/billing";
import { readMockToken } from "@/services/billing/mockBillingProvider";

import { mockCheckoutAction, mockPortalAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock billing", robots: { index: false } };

const BUTTON = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white";
const SECONDARY =
  "rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary";

/**
 * Development-only stand-in for Stripe Checkout and the Customer Portal
 * (ADR-042). 404 unless the mock billing provider is active outside
 * production.
 */
export default async function MockBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; portal?: string }>;
}) {
  if (!isMockBillingAvailable()) notFound();
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { checkout, portal } = await searchParams;
  const token = checkout ?? portal ?? "";
  if (!readMockToken(token)) notFound();

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-xs font-semibold tracking-wide text-warning uppercase">
        Development only: mock payment provider
      </p>
      {checkout ? (
        <>
          <h1 className="mt-2 text-2xl font-bold text-primary">Checkout</h1>
          <p className="mt-4 text-sm text-muted">
            Stripe would take the card details here. Choose what happens; the result is
            sent as a signed webhook.
          </p>
          <form action={mockCheckoutAction} className="mt-6 flex flex-wrap gap-3">
            <input type="hidden" name="token" value={token} />
            <button name="outcome" value="pay" className={BUTTON}>
              Pay (test)
            </button>
            <button name="outcome" value="cancel" className={SECONDARY}>
              Cancel
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 className="mt-2 text-2xl font-bold text-primary">Customer portal</h1>
          <p className="mt-4 text-sm text-muted">Simulate what Stripe would report.</p>
          <form action={mockPortalAction} className="mt-6 flex flex-wrap gap-3">
            <input type="hidden" name="token" value={token} />
            <button name="outcome" value="payment_failed" className={SECONDARY}>
              Renewal payment fails
            </button>
            <button name="outcome" value="renewed" className={SECONDARY}>
              Renewal succeeds
            </button>
            <button name="outcome" value="cancel_at_period_end" className={SECONDARY}>
              Cancel at period end
            </button>
            <button name="outcome" value="cancel_now" className={SECONDARY}>
              Cancel now
            </button>
          </form>
        </>
      )}
    </main>
  );
}
