-- Phase 5 Task 5 (ADR-055): the Admin flag for historical ROI on profile
-- track records. ROI is [OWNER] (formula undefined, OD-07): a documented
-- default is computed but shown only when this flag is on AND
-- FINANCIAL_PROMOTIONS_REVIEWED is true. Off by default. Additive only.

CREATE TABLE public.track_record_settings (
  "id"                integer NOT NULL DEFAULT 1,
  "showHistoricalRoi" boolean NOT NULL DEFAULT false,
  "updatedAt"         timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy"         uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT track_record_settings_pkey PRIMARY KEY ("id"),
  CONSTRAINT track_record_settings_single_row CHECK ("id" = 1)
);
INSERT INTO public.track_record_settings ("id", "showHistoricalRoi") VALUES (1, false);

ALTER TABLE public.track_record_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.track_record_settings FROM PUBLIC, anon, authenticated;
