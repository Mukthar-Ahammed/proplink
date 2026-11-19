-- Phase 3 Task 1: subscriptions for Agents, Lead Investors and Co-Investors
-- (ADR-042; Clarification Answers §D: only these pay, monthly or yearly;
-- Landlords and Buyers never pay; prices are Admin settings, OD-01).
-- Card data never reaches the app: Stripe Checkout and Customer Portal.
-- State changes only through verified webhooks. Money is integer pence.
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."SubscriptionAudience" AS ENUM ('AGENT', 'LEAD_INVESTOR', 'CO_INVESTOR');
CREATE TYPE public."BillingInterval" AS ENUM ('MONTH', 'YEAR');
CREATE TYPE public."SubscriptionStatus" AS ENUM
  ('INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED');

-- Admin-managed prices. Provider prices are immutable: a change retires the
-- old row and adds a new one; existing subscribers keep their price.
CREATE TABLE public.subscription_plans (
    "id" UUID NOT NULL,
    "audience" public."SubscriptionAudience" NOT NULL,
    "interval" public."BillingInterval" NOT NULL,
    "amountGBP" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPriceId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT subscription_plans_amount CHECK ("amountGBP" BETWEEN 100 AND 10000000),
    CONSTRAINT subscription_plans_provider CHECK ("provider" IN ('mock', 'stripe')),
    CONSTRAINT subscription_plans_retired CHECK ("active" = ("retiredAt" IS NULL))
);
CREATE UNIQUE INDEX "subscription_plans_one_active"
  ON public.subscription_plans ("audience", "interval") WHERE "active";
CREATE UNIQUE INDEX "subscription_plans_providerPriceId_key"
  ON public.subscription_plans ("providerPriceId");
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT "subscription_plans_createdBy_fkey" FOREIGN KEY ("createdBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Singleton billing settings (grace period after a failed payment, OD-01).
CREATE TABLE public.billing_settings (
    "id" INTEGER NOT NULL DEFAULT 1,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,
    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT billing_settings_singleton CHECK ("id" = 1),
    CONSTRAINT billing_settings_grace CHECK ("graceDays" BETWEEN 0 AND 60)
);

-- One provider customer per paying profile.
CREATE TABLE public.billing_customers (
    "profileId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT billing_customers_provider CHECK ("provider" IN ('mock', 'stripe'))
);
CREATE UNIQUE INDEX "billing_customers_providerCustomerId_key"
  ON public.billing_customers ("providerCustomerId");
ALTER TABLE public.billing_customers
  ADD CONSTRAINT "billing_customers_profileId_fkey" FOREIGN KEY ("profileId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mirror of provider subscriptions, written only by the webhook handler.
CREATE TABLE public.subscriptions (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "audience" public."SubscriptionAudience" NOT NULL,
    "interval" public."BillingInterval" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubscriptionId" TEXT NOT NULL,
    "providerPriceId" TEXT NOT NULL,
    "status" public."SubscriptionStatus" NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    -- First failed payment of the current dunning run; the grace period runs from here.
    "pastDueSince" TIMESTAMP(3),
    -- Provider event time of the last applied update (out-of-order guard).
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT subscriptions_provider CHECK ("provider" IN ('mock', 'stripe'))
);
CREATE UNIQUE INDEX "subscriptions_providerSubscriptionId_key"
  ON public.subscriptions ("providerSubscriptionId");
CREATE INDEX "subscriptions_profileId_audience_idx" ON public.subscriptions ("profileId", "audience");
CREATE INDEX "subscriptions_status_idx" ON public.subscriptions ("status");
ALTER TABLE public.subscriptions
  ADD CONSTRAINT "subscriptions_profileId_fkey" FOREIGN KEY ("profileId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Paying roles only: Agents hold AGENT plans, Investors the investor plans.
CREATE OR REPLACE FUNCTION public.proplink_subscription_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW."profileId"
      AND ((NEW.audience = 'AGENT' AND p.role = 'AGENT')
        OR (NEW.audience IN ('LEAD_INVESTOR', 'CO_INVESTOR') AND p.role = 'INVESTOR'))
  ) THEN
    RAISE EXCEPTION 'Only Agents and Investors hold subscriptions (Landlords and Buyers never pay)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."profileId" <> OLD."profileId"
     OR NEW."providerSubscriptionId" <> OLD."providerSubscriptionId") THEN
    RAISE EXCEPTION 'Subscription owner cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_subscription_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER subscriptions_guard
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.proplink_subscription_guard();

-- Webhook idempotency: an event is recorded in the same transaction that
-- applies it, so a replay is a no-op and a failure leaves nothing behind.
CREATE TABLE public.billing_webhook_events (
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventCreatedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("eventId"),
    CONSTRAINT billing_webhook_events_shape CHECK (
      "provider" IN ('mock', 'stripe') AND length("eventId") BETWEEN 1 AND 255 AND length("type") <= 100
    )
);

-- Server-only: no Data API access.
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_customers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_webhook_events FROM PUBLIC, anon, authenticated;
