-- Phase 5 Task 3 (ADR-056): saved searches with email alerts. Alerts are
-- queued (one per search per day at most), sent with per-user limits, and
-- every email carries an unsubscribe link (a random token per search).
-- Additive only.

ALTER TABLE public."SavedSearch"
  ADD COLUMN "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "alertToken" text;
CREATE UNIQUE INDEX "SavedSearch_alertToken_key" ON public."SavedSearch" ("alertToken");
CREATE INDEX "SavedSearch_alertsEnabled_idx" ON public."SavedSearch" ("alertsEnabled");

CREATE TYPE public."SavedSearchAlertStatus" AS ENUM ('QUEUED', 'SENT', 'SKIPPED', 'FAILED');

CREATE TABLE public.saved_search_alerts (
  "id"            uuid NOT NULL,
  "savedSearchId" text NOT NULL REFERENCES public."SavedSearch"(id) ON DELETE CASCADE,
  "userId"        text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "windowDay"     date NOT NULL,
  "listingIds"    text[] NOT NULL,
  "status"        public."SavedSearchAlertStatus" NOT NULL DEFAULT 'QUEUED',
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"        timestamp(3),
  CONSTRAINT saved_search_alerts_pkey PRIMARY KEY ("id"),
  CONSTRAINT saved_search_alerts_has_listings CHECK (cardinality("listingIds") BETWEEN 1 AND 20),
  CONSTRAINT saved_search_alerts_sent_pair CHECK (("status" = 'SENT') = ("sentAt" IS NOT NULL))
);
-- At most one alert per saved search per day.
CREATE UNIQUE INDEX saved_search_alerts_one_per_day
  ON public.saved_search_alerts ("savedSearchId", "windowDay");
CREATE INDEX saved_search_alerts_status ON public.saved_search_alerts ("status", "createdAt");
CREATE INDEX saved_search_alerts_user_day ON public.saved_search_alerts ("userId", "windowDay");

ALTER TABLE public.saved_search_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saved_search_alerts FROM PUBLIC, anon, authenticated;
