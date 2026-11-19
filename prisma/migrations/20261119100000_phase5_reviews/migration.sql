-- Phase 5 Task 4 (ADR-054): reviews and ratings from qualifying interactions
-- only (TRD RV-1 to RV-4, acceptance criterion 7, OD-17 default pairs):
--   Landlord     → Agent         on a CLOSED mandate          (context MANDATE)
--   Co-Investor  → Lead Investor on a SOLD project            (context PROJECT)
--   Co-Investor  → Agent         on a SOLD project            (context PROJECT)
--   Lead         → Agent         on a SOLD project            (context PROJECT)
--   Buyer        → Agent         after a Deal is COMPLETED    (context PURCHASE)
-- A Co-Investor is someone whose pledge on the project became BINDING.
-- One review per reviewer, subject and interaction; Admin publishes before
-- anyone sees it; the reviewed party may reply once; reports go to Admin.
-- Additive only.

CREATE TYPE public."ReviewContext" AS ENUM ('MANDATE', 'PROJECT', 'PURCHASE');
CREATE TYPE public."ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN');

CREATE TABLE public.reviews (
  "id"           uuid NOT NULL,
  "reviewerId"   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "subjectId"    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "contextType"  public."ReviewContext" NOT NULL,
  "contextId"    text NOT NULL,
  "rating"       integer NOT NULL,
  "body"         text NOT NULL,
  "status"       public."ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "moderatedBy"  uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "moderatedAt"  timestamp(3),
  "moderationNote" text,
  "reply"        text,
  "repliedAt"    timestamp(3),
  "createdAt"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reviews_pkey PRIMARY KEY ("id"),
  CONSTRAINT reviews_rating_range CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT reviews_body_length CHECK (char_length("body") BETWEEN 10 AND 2000),
  CONSTRAINT reviews_reply_length CHECK ("reply" IS NULL OR char_length("reply") BETWEEN 1 AND 1000),
  CONSTRAINT reviews_not_self CHECK ("reviewerId" <> "subjectId"),
  CONSTRAINT reviews_reply_pair CHECK (("reply" IS NULL) = ("repliedAt" IS NULL)),
  CONSTRAINT reviews_moderation_pair CHECK (
    ("status" = 'PENDING') = ("moderatedBy" IS NULL AND "moderatedAt" IS NULL)
  )
);
CREATE UNIQUE INDEX reviews_one_per_interaction
  ON public.reviews ("reviewerId", "subjectId", "contextType", "contextId");
CREATE INDEX reviews_subject_status ON public.reviews ("subjectId", "status");
CREATE INDEX reviews_status_created ON public.reviews ("status", "createdAt");
CREATE INDEX reviews_reviewer_created ON public.reviews ("reviewerId", "createdAt");

CREATE TABLE public.review_reports (
  "id"         uuid NOT NULL,
  "reviewId"   uuid NOT NULL REFERENCES public.reviews(id) ON DELETE RESTRICT,
  "reporterId" uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "reason"     text NOT NULL,
  "resolvedAt" timestamp(3),
  "resolvedBy" uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "createdAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT review_reports_pkey PRIMARY KEY ("id"),
  CONSTRAINT review_reports_reason_length CHECK (char_length("reason") BETWEEN 3 AND 500),
  CONSTRAINT review_reports_resolved_pair CHECK (("resolvedAt" IS NULL) = ("resolvedBy" IS NULL))
);
CREATE UNIQUE INDEX review_reports_one_per_reporter ON public.review_reports ("reviewId", "reporterId");
CREATE INDEX review_reports_open ON public.review_reports ("resolvedAt", "createdAt");

-- Is (reviewer → subject) a qualifying pair for this interaction?
CREATE OR REPLACE FUNCTION public.proplink_review_eligible(
  p_reviewer uuid, p_subject uuid, p_context public."ReviewContext", p_context_id text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  project_row record;
  reviewer_binding boolean;
BEGIN
  IF p_reviewer IS NULL OR p_subject IS NULL OR p_reviewer = p_subject THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reviewer AND active) THEN
    RETURN false;
  END IF;

  IF p_context = 'MANDATE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.mandates m
      JOIN public.landlord_listings l ON l.id = m."listingId"
      JOIN public.profiles rp ON rp.id = p_reviewer
      WHERE m.id::text = p_context_id
        AND m.status = 'CLOSED'
        AND l."ownerId" = p_reviewer
        AND rp.role = 'LANDLORD'
        AND m."agentId" = p_subject
    );
  END IF;

  IF p_context = 'PROJECT' THEN
    SELECT p.id, p."agentId", p."leadInvestorId", p.status::text AS status
      INTO project_row
      FROM public.investor_projects p
      WHERE p.id::text = p_context_id;
    IF NOT FOUND OR project_row.status <> 'SOLD' THEN
      RETURN false;
    END IF;
    reviewer_binding := EXISTS (
      SELECT 1 FROM public.project_pledges pl
      WHERE pl."projectId" = project_row.id
        AND pl."investorId" = p_reviewer
        AND pl.status = 'BINDING'
    );
    -- Lead → Agent
    IF project_row."leadInvestorId" IS NOT DISTINCT FROM p_reviewer THEN
      RETURN p_subject = project_row."agentId";
    END IF;
    -- Co-Investor → Lead or Agent
    IF reviewer_binding THEN
      RETURN p_subject = project_row."agentId"
          OR p_subject IS NOT DISTINCT FROM project_row."leadInvestorId";
    END IF;
    RETURN false;
  END IF;

  IF p_context = 'PURCHASE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public."Deal" d
      JOIN public."Offer" o ON o.id = d."offerId"
      JOIN public."Property" pr ON pr.id = d."propertyId"
      JOIN public."AgentProfile" ap ON ap.id = pr."agentProfileId"
      JOIN public.profiles rp ON rp."legacyUserId" = o."buyerUserId"
      JOIN public.profiles sp ON sp."legacyUserId" = ap."userId"
      WHERE d.id = p_context_id
        AND d.stage = 'COMPLETED'
        AND rp.id = p_reviewer
        AND rp.role = 'BUYER'
        AND sp.id = p_subject
    );
  END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_review_eligible(uuid, uuid, public."ReviewContext", text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proplink_review_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reviews are kept; Admin hides them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.proplink_review_eligible(NEW."reviewerId", NEW."subjectId", NEW."contextType", NEW."contextId") THEN
      RAISE EXCEPTION 'Reviews come only from a completed, qualifying interaction'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PENDING' OR NEW.reply IS NOT NULL THEN
      RAISE EXCEPTION 'A review starts pending moderation, without a reply'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."reviewerId" <> OLD."reviewerId" OR NEW."subjectId" <> OLD."subjectId"
     OR NEW."contextType" <> OLD."contextType" OR NEW."contextId" <> OLD."contextId"
     OR NEW.rating <> OLD.rating OR NEW.body <> OLD.body OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'A review''s author, subject, rating and text are fixed'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'PENDING' AND NEW.status IN ('PUBLISHED', 'REJECTED')) OR
      (OLD.status = 'PUBLISHED' AND NEW.status = 'HIDDEN') OR
      (OLD.status = 'HIDDEN' AND NEW.status = 'PUBLISHED')
    ) THEN
      RAISE EXCEPTION 'Review cannot move from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles a WHERE a.id = NEW."moderatedBy" AND a.role = 'ADMIN' AND a.active
    ) THEN
      RAISE EXCEPTION 'Only an Admin moderates reviews' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."moderatedBy" IS DISTINCT FROM OLD."moderatedBy" OR NEW."moderatedAt" IS DISTINCT FROM OLD."moderatedAt" THEN
    RAISE EXCEPTION 'Moderation fields change only with the status' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.reply IS DISTINCT FROM OLD.reply OR NEW."repliedAt" IS DISTINCT FROM OLD."repliedAt" THEN
    IF OLD.reply IS NOT NULL THEN
      RAISE EXCEPTION 'A reply is posted once' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'Replies go on published reviews' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_review_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_review_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.proplink_review_guard();

-- Reports: anyone signed in may report a published review once; only an Admin resolves.
CREATE OR REPLACE FUNCTION public.proplink_review_report_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Review reports are kept' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = NEW."reviewId" AND r.status = 'PUBLISHED') THEN
      RAISE EXCEPTION 'Only published reviews can be reported' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."resolvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A report starts open' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."reviewId" <> OLD."reviewId" OR NEW."reporterId" <> OLD."reporterId"
     OR NEW.reason <> OLD.reason OR OLD."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A report is fixed once made and once resolved' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles a WHERE a.id = NEW."resolvedBy" AND a.role = 'ADMIN' AND a.active
  ) THEN
    RAISE EXCEPTION 'Only an Admin resolves reports' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_review_report_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_review_report_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.review_reports
  FOR EACH ROW EXECUTE FUNCTION public.proplink_review_report_guard();

-- Server-only tables: the app reads them through services; no client access.
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.review_reports FROM PUBLIC, anon, authenticated;
