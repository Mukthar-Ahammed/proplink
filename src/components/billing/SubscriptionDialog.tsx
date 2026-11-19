"use client";

import NumberFlow from "@number-flow/react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  startEmbeddedCheckoutAction,
  type EmbeddedCheckoutResult,
} from "@/app/account/billing/actions";
import { mockCheckoutAction } from "@/app/account/billing/mock/actions";
import { cn } from "@/lib/cn";

import { CrownIcon } from "./CrownIcon";
import { OPEN_SUBSCRIPTION_EVENT } from "./events";

export type DialogPlan = {
  audience: string;
  title: string;
  body: string;
  includes: string[];
  monthly: { amountGBP: number; demo: boolean } | null;
  yearly: { amountGBP: number; demo: boolean } | null;
};

type Interval = "MONTH" | "YEAR";
type Step =
  | { kind: "plans" }
  | {
      kind: "checkout";
      plan: DialogPlan;
      interval: Interval;
      result: EmbeddedCheckoutResult | null;
    };

const pounds = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: pence % 100 ? 2 : 0,
  })}`;

// One Stripe.js instance per publishable key, created on first checkout only.
const stripePromises = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!stripePromises.has(key)) stripePromises.set(key, loadStripe(key));
  return stripePromises.get(key)!;
};

/**
 * The subscription popup (Clarification Answers §D: Agents, Lead Investors
 * and Co-Investors pay monthly or yearly to chat).
 *
 * Two steps in one native `<dialog>` (focus trapped, Esc closes, page inert):
 * 1. **Plans** — animated monthly/yearly switch and plan cards.
 * 2. **Checkout** — "Purchase" swaps the popup for Stripe Embedded Checkout,
 *    or, while no Stripe keys are set, the development mock's test checkout.
 *    Card details only ever go to Stripe.
 *
 * Opens from its own trigger button, from `autoOpen`, or (with `openOnEvent`)
 * from `OPEN_SUBSCRIPTION_EVENT`, which locked portal tabs dispatch.
 */
export function SubscriptionDialog({
  plans,
  reason,
  triggerLabel = "Subscribe to chat",
  triggerTone = "primary",
  autoOpen = false,
  hideTrigger = false,
  openOnEvent = false,
  returnPath = "/account/billing",
}: {
  plans: DialogPlan[];
  reason: string;
  triggerLabel?: string;
  triggerTone?: "primary" | "secondary";
  autoOpen?: boolean;
  /** Render only the popup; something else opens it (see `openOnEvent`). */
  hideTrigger?: boolean;
  openOnEvent?: boolean;
  /** Where a completed checkout lands: "/messages" or "/account/billing". */
  returnPath?: "/messages" | "/account/billing";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Starts true for `autoOpen`, so the effect below only has to open the
  // native dialog (no state change inside the effect).
  const [open, setOpen] = useState(autoOpen);
  const [interval, setBillingInterval] = useState<Interval>("MONTH");
  const [step, setStep] = useState<Step>({ kind: "plans" });
  const [pending, startTransition] = useTransition();
  const reduce = useReducedMotion();

  const show = useCallback(() => {
    setStep({ kind: "plans" });
    ref.current?.showModal();
    setOpen(true);
  }, []);
  const close = () => ref.current?.close();

  useEffect(() => {
    if (autoOpen) ref.current?.showModal();
  }, [autoOpen]);

  useEffect(() => {
    if (!openOnEvent) return;
    window.addEventListener(OPEN_SUBSCRIPTION_EVENT, show);
    return () => window.removeEventListener(OPEN_SUBSCRIPTION_EVENT, show);
  }, [openOnEvent, show]);

  const anyDemo = plans.some((p) => p.monthly?.demo || p.yearly?.demo);
  const hasYearly = plans.some((p) => p.yearly);
  const bestSaving = Math.max(
    0,
    ...plans.map((p) =>
      p.monthly && p.yearly
        ? Math.round((1 - p.yearly.amountGBP / (p.monthly.amountGBP * 12)) * 100)
        : 0,
    ),
  );

  const purchase = (plan: DialogPlan) => {
    setStep({ kind: "checkout", plan, interval, result: null });
    startTransition(async () => {
      const result = await startEmbeddedCheckoutAction({
        audience: plan.audience,
        interval,
        returnPath,
      });
      if (result.kind === "redirect") {
        window.location.assign(result.url);
        return;
      }
      setStep({ kind: "checkout", plan, interval, result });
    });
  };

  const reveal = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: -14, filter: "blur(8px)" },
          animate: open
            ? { opacity: 1, y: 0, filter: "blur(0px)" }
            : { opacity: 0, y: -14, filter: "blur(8px)" },
          transition: { delay: 0.12 + i * 0.12, duration: 0.45 },
        };

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={show}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
            triggerTone === "primary"
              ? "bg-accent text-white hover:bg-accent-strong"
              : "border border-line bg-white text-primary hover:border-accent hover:text-accent",
          )}
        >
          <LockIcon />
          {triggerLabel}
        </button>
      )}

      <dialog
        ref={ref}
        aria-labelledby="subscription-dialog-title"
        onClose={() => {
          setOpen(false);
          setStep({ kind: "plans" });
        }}
        className="m-auto max-h-none w-[min(60rem,calc(100vw-1.5rem))] overflow-hidden rounded-[2rem] border border-line bg-white p-0 text-left shadow-2xl backdrop:bg-primary/45 backdrop:backdrop-blur-sm"
        onClick={(event) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (event.target === ref.current) close();
        }}
      >
        {/* No scrolling: the plans step is sized to fit the viewport, and
            the plan details compact on short or narrow screens. */}
        <div>
          <AnimatePresence mode="wait" initial={false}>
            {step.kind === "plans" ? (
              <motion.div
                key="plans"
                initial={reduce ? false : { opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, x: -24 }}
                transition={{ duration: 0.25 }}
                className="p-5 sm:p-6 [@media(max-height:720px)]:p-4"
              >
                {/* ---------------------------------------------- header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-2 rounded-full bg-premium-soft px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
                      <CrownIcon className="h-3.5 w-3.5 text-premium" />
                      Subscription feature
                    </p>
                    <h2
                      id="subscription-dialog-title"
                      className="font-display mt-3 text-2xl leading-tight font-semibold tracking-[-0.02em] text-primary sm:text-3xl [@media(max-height:720px)]:mt-2 [@media(max-height:680px)]:text-xl"
                    >
                      <CutReveal text="Plans &" play={open} reduce={!!reduce} />{" "}
                      <span className="font-serif font-normal tracking-normal italic">
                        <CutReveal
                          text="pricing"
                          play={open}
                          reduce={!!reduce}
                          offset={2}
                        />
                      </span>
                    </h2>
                    <motion.p
                      {...reveal(0)}
                      className="mt-2 max-w-xl text-sm leading-relaxed text-muted"
                    >
                      {reason}
                    </motion.p>
                  </div>
                  <CloseButton onClick={close} />
                </div>

                {hasYearly && (
                  <motion.div
                    {...reveal(1)}
                    className="mt-4 [@media(max-height:720px)]:mt-3"
                  >
                    <PricingSwitch
                      value={interval}
                      onChange={setBillingInterval}
                      saving={bestSaving}
                    />
                  </motion.div>
                )}

                {/* ----------------------------------------------- plans */}
                <motion.div
                  {...reveal(2)}
                  className={cn(
                    "mt-4 grid gap-3 rounded-[1.75rem] bg-gradient-to-b from-surface to-pale p-2 sm:p-2.5 [@media(max-height:720px)]:mt-3",
                    plans.length === 1
                      ? "md:[@media(min-height:721px)]:grid-cols-[1fr_1.15fr]"
                      : "md:grid-cols-2",
                  )}
                >
                  {plans.length === 1 && <WhyPanel />}
                  {plans.map((plan, index) => (
                    <PlanCard
                      key={plan.audience}
                      plan={plan}
                      interval={interval}
                      featured={plans.length === 1 || index === 0}
                      onPurchase={() => purchase(plan)}
                      disabled={pending}
                    />
                  ))}
                </motion.div>

                <p className="mt-4 text-xs leading-relaxed text-muted max-md:text-[11px] [@media(max-height:720px)]:mt-3">
                  {anyDemo && (
                    <span className="font-semibold text-warning">
                      Demo prices: the real prices are not set yet.{" "}
                    </span>
                  )}
                  {/* Trimmed on phones so the popup fits without scrolling; the
                      checkout step repeats that card details go to Stripe. */}
                  <span className="max-md:hidden">
                    Payment is taken on Stripe&apos;s secure checkout; PropLink never sees
                    your card details. Chats also need PropLink&apos;s authorisation.
                    Landlords and Buyers never pay.
                  </span>
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="checkout"
                initial={reduce ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, x: 24 }}
                transition={{ duration: 0.25 }}
                className="p-5 sm:p-6"
              >
                <div className="flex items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => setStep({ kind: "plans" })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span aria-hidden>←</span> Plans
                  </button>
                  <p
                    id="subscription-dialog-title"
                    className="flex items-center gap-2 text-sm font-semibold text-primary"
                  >
                    <LockIcon /> Secure checkout
                  </p>
                  <CloseButton onClick={close} />
                </div>
                <div className="mt-5">
                  <CheckoutStep step={step} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </dialog>
    </>
  );
}

/* ------------------------------------------------------------- pieces */

/** Words slide down into place, like the reference's vertical cut reveal. */
function CutReveal({
  text,
  play,
  reduce,
  offset = 0,
}: {
  text: string;
  play: boolean;
  reduce: boolean;
  offset?: number;
}) {
  const words = text.split(" ");
  if (reduce) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          aria-hidden
          className="inline-flex overflow-hidden pb-1"
        >
          <motion.span
            className="inline-block"
            initial={{ y: "-100%" }}
            animate={{ y: play ? 0 : "-100%" }}
            transition={{
              type: "spring",
              stiffness: 250,
              damping: 30,
              delay: (offset + i) * 0.12,
            }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </>
  );
}

function PricingSwitch({
  value,
  onChange,
  saving,
}: {
  value: Interval;
  onChange: (value: Interval) => void;
  saving: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="inline-flex rounded-full border border-line bg-surface p-1"
    >
      {(["MONTH", "YEAR"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "relative rounded-full px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-6 [@media(max-height:680px)]:py-1.5",
            value === option ? "text-white" : "text-secondary hover:text-primary",
          )}
        >
          {value === option && (
            <motion.span
              layoutId="billing-period"
              className="absolute inset-0 rounded-full bg-accent shadow-sm"
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
            />
          )}
          <span className="relative flex items-center gap-2">
            {option === "MONTH" ? "Monthly" : "Yearly"}
            {option === "YEAR" && saving > 0 && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  value === "YEAR" ? "bg-white/20 text-white" : "bg-pale text-accent",
                )}
              >
                Save {saving}%
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Left panel when there is a single plan (e.g. Agents). */
function WhyPanel() {
  const points = [
    "Browsing, listings and enquiries stay free",
    "Every chat still needs PropLink's authorisation",
    "Cancel any time",
  ];
  return (
    <div className="flex flex-col justify-between rounded-3xl p-5 max-md:hidden [@media(max-height:720px)]:hidden">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Why subscribe
        </p>
        <p className="mt-2 text-lg leading-snug font-semibold text-primary">
          Talk to the people behind every deal, in one secure place.
        </p>
      </div>
      <ul className="mt-5 space-y-3">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-3 text-sm text-body">
            <CheckChip />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({
  plan,
  interval,
  featured,
  onPurchase,
  disabled,
}: {
  plan: DialogPlan;
  interval: Interval;
  featured: boolean;
  onPurchase: () => void;
  disabled: boolean;
}) {
  const price = interval === "YEAR" ? plan.yearly : plan.monthly;
  const saving =
    interval === "YEAR" && plan.monthly && plan.yearly
      ? plan.monthly.amountGBP * 12 - plan.yearly.amountGBP
      : 0;
  return (
    <div
      className={cn(
        "relative isolate flex flex-col overflow-hidden rounded-3xl p-5 max-md:p-4 [@media(max-height:720px)]:p-4",
        featured
          ? "bg-brand text-white shadow-xl ring-1 ring-accent/40"
          : "border border-line bg-white text-primary",
      )}
    >
      {featured && (
        <div
          aria-hidden
          className="absolute -top-20 -right-16 -z-10 h-56 w-56 rounded-full bg-accent/50 blur-3xl"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold">{plan.title}</h3>
        {featured && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
            <CrownIcon className="h-3.5 w-3.5 text-premium" />
            Chat access
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-1.5 text-sm leading-relaxed max-md:hidden",
          featured ? "text-pale/80" : "text-muted",
        )}
      >
        {plan.body}
      </p>

      {price ? (
        <div className="mt-4 max-md:mt-1.5 [@media(max-height:720px)]:mt-2">
          <p className="flex items-baseline gap-1">
            <NumberFlow
              value={price.amountGBP / 100}
              format={{
                style: "currency",
                currency: "GBP",
                minimumFractionDigits: price.amountGBP % 100 ? 2 : 0,
                maximumFractionDigits: 2,
              }}
              locales="en-GB"
              className="font-display text-3xl font-semibold tracking-[-0.02em] max-md:text-2xl"
            />
            <span className={featured ? "text-pale/70" : "text-muted"}>
              /{interval === "YEAR" ? "year" : "month"}
            </span>
          </p>
          <p
            className={cn(
              "mt-1 h-5 text-xs font-semibold max-md:h-auto max-md:empty:hidden",
              featured ? "text-pale" : "text-success",
            )}
          >
            {saving > 0 ? `Save ${pounds(saving)} a year` : ""}
          </p>
        </div>
      ) : (
        <p className={cn("mt-6 text-sm", featured ? "text-pale/80" : "text-muted")}>
          This billing period is not available yet.
        </p>
      )}

      <ul
        className={cn(
          // Dropped on phones and short screens so the popup never scrolls.
          "mt-3 flex-1 space-y-2 border-t pt-4 text-sm max-md:hidden [@media(max-height:720px)]:hidden",
          featured ? "border-white/15" : "border-line",
        )}
      >
        {plan.includes.map((line) => (
          <li key={line} className="flex items-start gap-3">
            <CheckChip dark={featured} />
            <span className={featured ? "text-pale/90" : "text-body"}>{line}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={disabled || !price}
        onClick={onPurchase}
        className={cn(
          "mt-5 w-full rounded-full px-5 py-3 text-base font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 max-md:mt-3 max-md:py-2.5 max-md:text-sm [@media(max-height:720px)]:mt-3 [@media(max-height:720px)]:py-2.5",
          featured
            ? "bg-white text-primary hover:bg-pale focus-visible:ring-white focus-visible:ring-offset-brand"
            : "bg-accent text-white hover:bg-accent-strong focus-visible:ring-accent",
        )}
      >
        Purchase
      </button>
    </div>
  );
}

function CheckoutStep({ step }: { step: Extract<Step, { kind: "checkout" }> }) {
  const { result, plan, interval } = step;
  if (!result) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3 rounded-3xl border border-line bg-surface/60 text-sm text-muted">
        <span
          aria-hidden
          className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent"
        />
        <span role="status">Opening secure checkout…</span>
      </div>
    );
  }
  if (result.kind === "error" || result.kind === "redirect") {
    return (
      <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {result.kind === "error" ? result.message : "Redirecting to checkout…"}
      </p>
    );
  }
  if (result.kind === "stripe") {
    return (
      // Stripe's form is an iframe whose height Stripe controls; it is capped to
      // the viewport so the popup itself never scrolls.
      <div className="max-h-[calc(100svh-9rem)] overflow-y-auto rounded-3xl border border-line bg-white">
        <EmbeddedCheckoutProvider
          stripe={stripeFor(result.publishableKey)}
          options={{ clientSecret: result.clientSecret }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    );
  }
  return (
    <MockCheckout
      plan={plan}
      interval={interval}
      token={result.token}
      next={result.returnPath}
    />
  );
}

const FIELD =
  "mt-1 block w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-muted";

/**
 * Development stand-in for Stripe's embedded checkout while no Stripe keys
 * are set: laid out like the real thing, card entry disabled, and "Subscribe"
 * only sends the signed mock webhook (`mockCheckoutAction`).
 */
function MockCheckout({
  plan,
  interval,
  token,
  next,
}: {
  plan: DialogPlan;
  interval: Interval;
  token: string;
  next: string;
}) {
  const price = interval === "YEAR" ? plan.yearly : plan.monthly;
  const amount = price?.amountGBP ?? 0;
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-white">
      <p className="bg-warning/10 px-5 py-2.5 text-xs font-semibold text-warning">
        Test checkout: Stripe is not connected yet. Nothing is charged.
      </p>
      <div className="grid md:grid-cols-2">
        <section className="border-b border-line bg-surface/70 p-6 sm:p-7 md:border-r md:border-b-0">
          <p className="text-sm text-muted">Subscribe to PropLink UK</p>
          <p
            className="mt-2 text-3xl font-semibold text-primary"
            data-testid="checkout-amount"
          >
            {pounds(amount)}
            <span className="text-base font-normal text-muted">
              {" "}
              per {interval === "YEAR" ? "year" : "month"}
            </span>
          </p>
          <div className="mt-6 flex items-start justify-between gap-4 border-t border-line pt-4 text-sm">
            <div>
              <p className="font-semibold text-primary">{plan.title} subscription</p>
              <p className="mt-1 text-xs text-muted">
                Billed {interval === "YEAR" ? "yearly" : "monthly"}
              </p>
            </div>
            <p className="shrink-0 font-semibold text-primary">{pounds(amount)}</p>
          </div>
          <div className="mt-4 flex justify-between border-t border-line pt-4 text-sm font-semibold text-primary">
            <span>Total due today</span>
            <span>{pounds(amount)}</span>
          </div>
          {price?.demo && (
            <p className="mt-4 rounded-xl bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
              Demo price: the real price is not set yet.
            </p>
          )}
        </section>
        <section className="p-6 sm:p-7">
          <p className="text-base font-semibold text-primary">Payment details</p>
          <p className="mt-1 text-xs text-muted">
            Card entry is switched off until Stripe is connected.
          </p>
          <div className="mt-4 space-y-3" aria-disabled>
            <label className="block text-xs font-medium text-secondary">
              Card number
              <input disabled placeholder="4242 4242 4242 4242" className={FIELD} />
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
          </div>
          <form action={mockCheckoutAction} className="mt-6">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="next" value={next} />
            <button
              name="outcome"
              value="pay"
              className="w-full rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Subscribe (test, no charge)
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-pale hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        className="h-4 w-4"
      >
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

function CheckChip({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 grid h-5 w-5 shrink-0 place-content-center rounded-full",
        dark ? "bg-white/10 text-white ring-1 ring-white/25" : "bg-pale text-accent",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        className="h-3 w-3"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
