import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  audiencesFor,
  listActivePlans,
  subscriptionState,
} from "@/services/billing/subscriptions";

import { ManageBillingButton, SubscribeButton } from "./BillingForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing — PropLink UK", robots: { index: false } };

const AUDIENCE: Record<string, { title: string; body: string }> = {
  AGENT: {
    title: "Agent",
    body: "Chat with landlords once PropLink authorises it, and later publish projects to investors.",
  },
  LEAD_INVESTOR: {
    title: "Lead Investor",
    body: "Lead projects and chat with the agent and co-investors.",
  },
  CO_INVESTOR: {
    title: "Co-Investor",
    body: "Join projects as a co-investor and chat with the lead investor.",
  },
};

const pounds = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: pence % 100 ? 2 : 0 })}`;
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "—");

/**
 * Subscriptions for Agents, Lead Investors and Co-Investors only (Phase 3
 * Task 1, ADR-042; Clarification Answers §D). Landlords and Buyers never see
 * billing. Payment happens on the provider's hosted pages.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const audiences = audiencesFor(session.user.role);
  if (audiences.length === 0) notFound();
  const { checkout } = await searchParams;
  const [state, plans] = await Promise.all([
    subscriptionState({ profileId: session.user.authUserId, role: session.user.role }),
    listActivePlans(),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-primary">Billing</h1>
      {checkout === "success" && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-success/40 bg-success/5 p-3 text-sm"
        >
          Thank you. Your subscription starts as soon as the payment provider confirms it
          (usually within a minute).
        </p>
      )}
      {checkout === "cancelled" && (
        <p role="status" className="mt-4 text-sm text-muted">
          Checkout was cancelled. Nothing was charged.
        </p>
      )}

      <section
        className="mt-6 rounded-lg border border-line bg-white p-4"
        data-testid="subscription-state"
      >
        {state.state === "active" ? (
          <p className="text-sm text-body">
            <strong className="text-success">Active</strong> (
            {AUDIENCE[state.audience].title}).{" "}
            {state.cancelAtPeriodEnd ? "Ends" : "Renews"} on {day(state.periodEnd)}.
          </p>
        ) : state.state === "grace" ? (
          <p className="text-sm text-body">
            <strong className="text-warning">Payment failed.</strong> Update your payment
            details before {day(state.graceEndsAt)} to keep chatting; after that your
            chats become read-only until you renew.
          </p>
        ) : state.state === "lapsed" ? (
          <p className="text-sm text-body">
            <strong className="text-danger">Not active.</strong> Your chats are read-only
            until you subscribe again.
          </p>
        ) : (
          <p className="text-sm text-body">
            You have no subscription yet. You need one to chat (after PropLink authorises
            each chat).
          </p>
        )}
        {state.state !== "none" && (
          <div className="mt-3">
            <ManageBillingButton />
          </div>
        )}
      </section>

      {state.state !== "active" && state.state !== "grace" && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          {audiences.map((audience) => {
            const monthly = plans.find(
              (plan) => plan.audience === audience && plan.interval === "MONTH",
            );
            const yearly = plans.find(
              (plan) => plan.audience === audience && plan.interval === "YEAR",
            );
            const saving =
              monthly && yearly ? monthly.amountGBP * 12 - yearly.amountGBP : 0;
            return (
              <div
                key={audience}
                className="space-y-3 rounded-lg border border-line bg-white p-4"
              >
                <h2 className="text-base font-semibold text-primary">
                  {AUDIENCE[audience].title}
                </h2>
                <p className="text-sm text-muted">{AUDIENCE[audience].body}</p>
                {!monthly && !yearly && (
                  <p className="text-sm text-muted">Prices are not available yet.</p>
                )}
                {monthly && (
                  <SubscribeButton
                    audience={audience}
                    interval="MONTH"
                    label={`${pounds(monthly.amountGBP)} a month`}
                  />
                )}
                {yearly && (
                  <SubscribeButton
                    audience={audience}
                    interval="YEAR"
                    label={`${pounds(yearly.amountGBP)} a year${saving > 0 ? ` (save ${pounds(saving)})` : ""}`}
                  />
                )}
              </div>
            );
          })}
        </section>
      )}
      <p className="mt-8 text-xs text-muted">
        Payments are handled by our payment provider; PropLink never sees your card
        details. Subscriptions are the only payments taken in PropLink.
      </p>
    </main>
  );
}
