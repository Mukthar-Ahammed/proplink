-- Manual rollback for 20261007000000_phase3_rls_storage.
-- Run only after Phase 3-created Storage objects have been removed through the
-- Storage API. Refuse to orphan object metadata or underlying files.

DO $phase3_rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id IN ('kyc-documents', 'property-images')
  ) THEN
    RAISE EXCEPTION 'Phase 3 rollback refused: storage buckets are not empty';
  END IF;
END
$phase3_rollback$;

DROP POLICY IF EXISTS p3_storage_select ON storage.objects;
DROP POLICY IF EXISTS p3_storage_insert ON storage.objects;
DROP POLICY IF EXISTS p3_storage_update ON storage.objects;
DROP POLICY IF EXISTS p3_storage_delete ON storage.objects;
-- Supabase Storage's own API sets this transaction-local guard after it has
-- removed underlying objects. The emptiness assertion above makes the same
-- protected metadata deletion safe for these migration-created buckets.
SELECT set_config('storage.allow_delete_query', 'true', true);
DELETE FROM storage.buckets WHERE id IN ('kyc-documents', 'property-images');

REVOKE ALL ON storage.buckets, storage.objects FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON storage.buckets, storage.objects TO anon, authenticated;

ALTER FUNCTION public.property_search_vector_update() RESET search_path;
GRANT EXECUTE ON FUNCTION public.property_search_vector_update() TO PUBLIC;

DO $phase3$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AdSlot', 'AgentProfile', 'Appraisal', 'AuditLog', 'CaseStudy',
    'ChatMessage', 'ComparableSale', 'Deal', 'Enquiry', 'KycRecord',
    'LedgerEntry', 'Milestone', 'MilestonePhoto', 'Offer', 'Partner',
    'Property', 'PropertyDistressTag', 'PropertyImage', 'SavedProperty',
    'SavedSearch', 'Subscription', 'SuccessFee', 'SyndicatePledge',
    'SyndicateProject', 'User', 'VerificationToken', 'Viewing',
    '_prisma_migrations', 'profiles'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS p3_select ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS p3_insert ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS p3_update ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS p3_delete ON public.%I', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END
$phase3$;

-- Restore the exact pre-Phase-3 grants recorded by the staging inventory.
GRANT REFERENCES, TRIGGER, TRUNCATE ON
  public."AdSlot", public."AgentProfile", public."Appraisal", public."AuditLog",
  public."CaseStudy", public."ChatMessage", public."ComparableSale", public."Deal",
  public."Enquiry", public."KycRecord", public."LedgerEntry", public."Milestone",
  public."MilestonePhoto", public."Offer", public."Partner", public."Property",
  public."PropertyDistressTag", public."PropertyImage", public."SavedProperty",
  public."SavedSearch", public."Subscription", public."SuccessFee",
  public."SyndicatePledge", public."SyndicateProject", public."User",
  public."VerificationToken", public."Viewing", public._prisma_migrations
TO anon, authenticated;

DROP FUNCTION private.property_agent_user_id(text);
DROP FUNCTION private.can_access_project(text);
DROP FUNCTION private.participates_in_project(text);
DROP FUNCTION private.can_view_property(text);
DROP FUNCTION private.owns_property(text);
DROP FUNCTION private.owns_agent_profile(text);
DROP FUNCTION private.current_kyc_status();
DROP FUNCTION private.current_role();
DROP FUNCTION private.current_legacy_user_id();
DROP SCHEMA private;
