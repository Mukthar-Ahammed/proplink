import type { ReactNode } from "react";

import { auth } from "@/lib/auth";
import { listPlanOffers } from "@/services/billing/demoPlans";
import {
  allowsPaidFeatures,
  audiencesFor,
  subscriptionState,
} from "@/services/billing/subscriptions";

import { PLAN_COPY } from "./planCopy";
import { SubscriptionDialog, type DialogPlan } from "./SubscriptionDialog";

/** Plans the signed-in viewer can pick, shaped for the dialog. */
async function dialogPlans(role: Parameters<typeof audiencesFor>[0]) {
  const offers = await listPlanOffers();
  return audiencesFor(role).map((audience): DialogPlan => {
    const find = (interval: "MONTH" | "YEAR") => {
      const offer = offers.find(
        (o) => o.audience === audience && o.interval === interval,
      );
      return offer ? { amountGBP: offer.amountGBP, demo: offer.demo } : null;
    };
    return {
      audience,
      title: PLAN_COPY[audience]?.title ?? audience,
      body: PLAN_COPY[audience]?.body ?? "",
      includes: PLAN_COPY[audience]?.includes ?? [],
      monthly: find("MONTH"),
      yearly: find("YEAR"),
    };
  });
}

/**
 * Wraps an action that needs a subscription (in the business model: chat
 * only, Clarification Answers §D). Renders `children` when the viewer has an
 * active plan (or is in the failed-payment grace period) or never needs one
 * (Landlords, Buyers); otherwise renders a "Subscribe to chat" button that
 * opens the subscription popup in its place. The server still enforces the
 * rule on every send; this only saves the user a dead end.
 */
export async function SubscriptionGate({
  children,
  reason = "Chats on PropLink need an active subscription for Agents, Lead Investors and Co-Investors.",
  triggerLabel,
  triggerTone,
  autoOpen,
  hideTrigger,
  openOnEvent,
  returnPath,
}: {
  children?: ReactNode;
  reason?: string;
  triggerLabel?: string;
  triggerTone?: "primary" | "secondary";
  autoOpen?: boolean;
  /** Popup only, opened by `OPEN_SUBSCRIPTION_EVENT` (e.g. a locked portal tab). */
  hideTrigger?: boolean;
  openOnEvent?: boolean;
  returnPath?: "/messages" | "/account/billing";
}) {
  const session = await auth();
  if (!session?.user) return <>{children}</>;
  const viewer = { profileId: session.user.authUserId, role: session.user.role };
  const state = await subscriptionState(viewer);
  if (allowsPaidFeatures(state)) return <>{children}</>;
  const plans = await dialogPlans(viewer.role);
  if (plans.every((plan) => !plan.monthly && !plan.yearly)) return <>{children}</>;
  return (
    <SubscriptionDialog
      plans={plans}
      reason={
        state.state === "lapsed"
          ? "Your subscription has ended, so your chats are read-only. Renew to send messages again."
          : reason
      }
      triggerLabel={
        triggerLabel ?? (state.state === "lapsed" ? "Renew subscription" : undefined)
      }
      triggerTone={triggerTone}
      autoOpen={autoOpen}
      hideTrigger={hideTrigger}
      openOnEvent={openOnEvent}
      returnPath={returnPath}
    />
  );
}

/**
 * A full-width notice with the subscribe button, for portal home pages and the
 * messages list. Renders nothing when no subscription is needed.
 */
export async function SubscriptionBanner({ autoOpen = false }: { autoOpen?: boolean }) {
  const session = await auth();
  if (!session?.user) return null;
  const viewer = { profileId: session.user.authUserId, role: session.user.role };
  const state = await subscriptionState(viewer);
  if (allowsPaidFeatures(state)) return null;
  const lapsed = state.state === "lapsed";
  return (
    <div
      data-testid="subscription-banner"
      className="flex flex-col gap-4 rounded-3xl border border-accent/30 bg-pale/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div>
        <p className="text-sm font-semibold text-primary">
          {lapsed ? "Your subscription has ended" : "Subscribe to start chatting"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {lapsed
            ? "Your chats are read-only until you renew. Everything else keeps working."
            : "Browsing is free. Chatting needs a monthly or yearly subscription, plus PropLink's authorisation for each chat."}
        </p>
      </div>
      <div className="shrink-0">
        <SubscriptionGate autoOpen={autoOpen} />
      </div>
    </div>
  );
}

/**
 * True when the signed-in viewer would be shown the subscription popup: they
 * need a plan, have none active, and at least one plan is priced. Portal
 * layouts use it to lock subscription tabs (`PortalNavItem.locked`) only when
 * the popup that the tab opens will actually be there.
 */
export async function needsSubscriptionPopup(): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  const viewer = { profileId: session.user.authUserId, role: session.user.role };
  if (allowsPaidFeatures(await subscriptionState(viewer))) return false;
  const plans = await dialogPlans(viewer.role);
  return plans.some((plan) => plan.monthly || plan.yearly);
}
