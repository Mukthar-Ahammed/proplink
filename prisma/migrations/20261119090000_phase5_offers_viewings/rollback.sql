-- Rollback for 20261119090000_phase5_offers_viewings.
-- History is lost; offers or viewings already in a new status keep it (the
-- enum values cannot be removed without rewriting the types).
DROP TRIGGER IF EXISTS proplink_viewing_guard ON public."Viewing";
DROP TRIGGER IF EXISTS proplink_offer_guard ON public."Offer";
DROP FUNCTION IF EXISTS public.proplink_viewing_guard();
DROP FUNCTION IF EXISTS public.proplink_offer_guard();
DROP TABLE IF EXISTS public.viewing_events;
DROP TABLE IF EXISTS public.offer_events;
DROP INDEX IF EXISTS public."Offer_one_accepted_per_property";
ALTER TABLE public."Offer" DROP CONSTRAINT IF EXISTS offer_counter_amount;
ALTER TABLE public."Viewing" DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE public."Viewing" DROP COLUMN IF EXISTS "createdAt";
ALTER TABLE public."Offer" DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE public."Offer" DROP COLUMN IF EXISTS "expiresAt";
ALTER TABLE public."Offer" DROP COLUMN IF EXISTS "counterAmountGBP";
