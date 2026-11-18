-- Rollback for 20261118160000_phase3_billing.
-- The app's copy of plans, customers, subscriptions and processed webhook
-- events is lost. Stripe keeps the real records; replaying Stripe events (or
-- re-syncing) rebuilds the mirror. BILLING_* audit rows remain.
DROP TABLE IF EXISTS public.billing_webhook_events;
DROP TABLE IF EXISTS public.subscriptions;
DROP FUNCTION IF EXISTS public.proplink_subscription_guard();
DROP TABLE IF EXISTS public.billing_customers;
DROP TABLE IF EXISTS public.billing_settings;
DROP TABLE IF EXISTS public.subscription_plans;
DROP TYPE IF EXISTS public."SubscriptionStatus";
DROP TYPE IF EXISTS public."BillingInterval";
DROP TYPE IF EXISTS public."SubscriptionAudience";
