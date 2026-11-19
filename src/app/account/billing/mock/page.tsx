import { SubmitButton } from "@/components/ui/submit-button";
import { notFound, redirect } from "next/navigation";

import { PLAN_COPY } from "@/components/billing/planCopy";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isMockBillingAvailable } from "@/services/billing";
import { readMockToken } from "@/services/billing/mockBillingProvider";

import { mockCheckoutAction, mockPortalAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock billing", robots: { index: false } };

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
  const data = readMockToken(token);
  if (!data) notFound();
  const order = checkout ? await orderFor(data) : null;
  if (checkout && !order) notFound();

  return (
    <main className={`mx-auto px-4 py-16 ${order ? "max-w-4xl" : "max-w-xl"}`}>
      <p className="text-xs font-semibold tracking-wide text-warning uppercase">
        {order
          ? "Test checkout: Stripe is not connected yet"
          : "Development only: mock payment provider"}
      </p>
      {checkout && order ? (
        <CheckoutView token={token} order={order} />
      ) : (
        <>
          <h1 className="mt-2 text-2xl font-bold text-primary">Customer portal</h1>
          <p className="mt-4 text-sm text-muted">Simulate what Stripe would report.</p>
          <form action={mockPortalAction} className="mt-6 flex flex-wrap gap-3">
            <input type="hidden" name="token" value={token} />
            <SubmitButton name="outcome" value="payment_failed" className={SECONDARY}>
              Renewal payment fails
            </SubmitButton>
            <SubmitButton name="outcome" value="renewed" className={SECONDARY}>
              Renewal succeeds
            </SubmitButton>
            <SubmitButton
              name="outcome"
              value="cancel_at_period_end"
              className={SECONDARY}
            >
              Cancel at period end
            </SubmitButton>
            <SubmitButton name="outcome" value="cancel_now" className={SECONDARY}>
              Cancel now
            </SubmitButton>
          </form>
        </>
      )}
    </main>
  );
}

const pounds = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

type Order = {
  title: string;
  body: string;
  amountGBP: number;
  interval: "MONTH" | "YEAR";
  demo: boolean;
};

/** What the signed token is for: a stored Admin price, or a demo price. */
async function orderFor(data: Record<string, string>): Promise<Order | null> {
  const copy = PLAN_COPY[data.audience];
  if (!copy) return null;
  if (
    data.demoAmount &&
    (data.demoInterval === "MONTH" || data.demoInterval === "YEAR")
  ) {
    return {
      ...copy,
      amountGBP: Number(data.demoAmount),
      interval: data.demoInterval,
      demo: true,
    };
  }
  const plan = await db.subscriptionPlan.findUnique({
    where: { providerPriceId: data.priceId },
    select: { amountGBP: true, interval: true },
  });
  return plan ? { ...copy, ...plan, demo: false } : null;
}

const FIELD =
  "mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-muted";

/**
 * Stand-in for the payment provider's hosted checkout while no Stripe keys
 * are set. Laid out like a real checkout (order summary, card details, pay)
 * so the flow can be reviewed, but the card fields are disabled: nothing is
 * charged, and "Pay" only sends a signed mock webhook.
 */
function CheckoutView({ token, order }: { token: string; order: Order }) {
  const per = order.interval === "YEAR" ? "year" : "month";
  return (
    <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
      <div className="grid md:grid-cols-2">
        <section className="border-b border-line bg-surface/70 p-6 md:border-r md:border-b-0 sm:p-8">
          <p className="text-sm text-muted">Subscribe to PropLink UK</p>
          <p
            className="mt-2 text-3xl font-semibold text-primary"
            data-testid="checkout-amount"
          >
            {pounds(order.amountGBP)}
            <span className="text-base font-normal text-muted"> per {per}</span>
          </p>
          <div className="mt-6 flex items-start justify-between gap-4 border-t border-line pt-4 text-sm">
            <div>
              <p className="font-semibold text-primary">{order.title} subscription</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{order.body}</p>
              <p className="mt-1 text-xs text-muted">
                Billed {order.interval === "YEAR" ? "yearly" : "monthly"}
              </p>
            </div>
            <p className="shrink-0 font-semibold text-primary">
              {pounds(order.amountGBP)}
            </p>
          </div>
          <div className="mt-4 flex justify-between border-t border-line pt-4 text-sm font-semibold text-primary">
            <span>Total due today</span>
            <span>{pounds(order.amountGBP)}</span>
          </div>
          {order.demo && (
            <p className="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
              Demo price: the real price is not set yet.
            </p>
          )}
        </section>

        <section className="p-6 sm:p-8">
          <h2 className="text-base font-semibold text-primary">Payment details</h2>
          <p className="mt-1 text-xs text-muted">
            Card entry is switched off until Stripe is connected.
          </p>
          <div className="mt-4 space-y-3" aria-disabled>
            <label className="block text-xs font-medium text-secondary">
              Card number
              <input disabled placeholder="1234 1234 1234 1234" className={FIELD} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-secondary">
                Expiry
                <input disabled placeholder="MM / YY" className={FIELD} />
              </label>
              <label className="block text-xs font-medium text-secondary">
                CVC
                <input disabled placeholder="CVC" className={FIELD} />
              </label>
            </div>
            <label className="block text-xs font-medium text-secondary">
              Name on card
              <input disabled placeholder="Full name" className={FIELD} />
            </label>
          </div>
          <form action={mockCheckoutAction} className="mt-6 space-y-3">
            <input type="hidden" name="token" value={token} />
            <SubmitButton
              name="outcome"
              value="pay"
              className="w-full rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong"
            >
              Subscribe (test, no charge)
            </SubmitButton>
            <SubmitButton
              name="outcome"
              value="cancel"
              className="w-full rounded-full border border-line px-5 py-3 text-sm font-semibold text-primary transition-colors hover:border-accent hover:text-accent"
            >
              Cancel and go back
            </SubmitButton>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            Once Stripe keys are added, this step opens Stripe&apos;s own secure checkout
            instead; PropLink never sees card details.
          </p>
        </section>
      </div>
    </div>
  );
}
