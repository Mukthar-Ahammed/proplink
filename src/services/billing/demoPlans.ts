import "server-only";

import { getServerEnv } from "@/env";
import type { BillingInterval, SubscriptionAudience } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getBillingProvider } from "@/services/billing";

/**
 * Placeholder prices (OD-01: the owner has not set real ones). Used only
 * outside production and only for a plan the Admin has not priced yet on
 * `/admin/billing`, so the subscribe flow can be shown end to end before the
 * owner decides. Pence. A real Admin price always wins.
 */
export const DEMO_PRICES: Record<
  SubscriptionAudience,
  Record<BillingInterval, number>
> = {
  AGENT: { MONTH: 4900, YEAR: 49000 },
  LEAD_INVESTOR: { MONTH: 2900, YEAR: 29000 },
  CO_INVESTOR: { MONTH: 1900, YEAR: 19000 },
};

const AUDIENCES = Object.keys(DEMO_PRICES) as SubscriptionAudience[];
const INTERVALS: BillingInterval[] = ["MONTH", "YEAR"];

/** One plan a viewer can pick: a real Admin price, or a demo placeholder. */
export type PlanOffer = {
  audience: SubscriptionAudience;
  interval: BillingInterval;
  amountGBP: number;
  /** Provider price ID for a real plan; null for a demo plan. */
  priceId: string | null;
  demo: boolean;
};

export function demoPricesAllowed(): boolean {
  return getServerEnv().ALLOW_MOCKS;
}

export function demoPriceId(audience: SubscriptionAudience, interval: BillingInterval) {
  return `price_demo_${audience.toLowerCase()}_${interval.toLowerCase()}`;
}

/**
 * Every plan on offer for the active provider. Plans priced for another
 * provider (for example mock prices once Stripe keys are added) are skipped,
 * because their price IDs do not exist there.
 */
export async function listPlanOffers(): Promise<PlanOffer[]> {
  const provider = getBillingProvider().name;
  const plans = await db.subscriptionPlan.findMany({
    where: { active: true, provider },
    select: { audience: true, interval: true, amountGBP: true, providerPriceId: true },
  });
  const demo = demoPricesAllowed();
  const offers: PlanOffer[] = [];
  for (const audience of AUDIENCES) {
    for (const interval of INTERVALS) {
      const plan = plans.find((p) => p.audience === audience && p.interval === interval);
      if (plan) {
        offers.push({
          audience,
          interval,
          amountGBP: plan.amountGBP,
          priceId: plan.providerPriceId,
          demo: false,
        });
      } else if (demo) {
        offers.push({
          audience,
          interval,
          amountGBP: DEMO_PRICES[audience][interval],
          priceId: null,
          demo: true,
        });
      }
    }
  }
  return offers;
}
