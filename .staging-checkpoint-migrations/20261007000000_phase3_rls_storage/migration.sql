-- Phase 3: least-privilege Data API, RLS, function/view hardening and Storage.
-- The application continues to use Prisma on the trusted server. These grants
-- expose only the operations that are safe for a publishable-key client.

CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE FUNCTION private.current_legacy_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p."legacyUserId"
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.active
$$;

CREATE FUNCTION private.current_role()
RETURNS public."Role"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.active
$$;

CREATE FUNCTION private.current_kyc_status()
RETURNS public."KycStatus"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p."kycStatus"
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.active
$$;

CREATE FUNCTION private.owns_agent_profile(target_profile_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."AgentProfile" AS ap
    WHERE ap.id = target_profile_id
      AND ap."userId" = (SELECT private.current_legacy_user_id())
  )
$$;

CREATE FUNCTION private.owns_property(target_property_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."Property" AS p
    JOIN public."AgentProfile" AS ap ON ap.id = p."agentProfileId"
    WHERE p.id = target_property_id
      AND ap."userId" = (SELECT private.current_legacy_user_id())
  )
$$;

CREATE FUNCTION private.can_view_property(target_property_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."Property" AS p
    LEFT JOIN public."AgentProfile" AS ap ON ap.id = p."agentProfileId"
    WHERE p.id = target_property_id
      AND (
        p.status IN ('LIVE', 'UNDER_OFFER', 'SOLD')
        OR ap."userId" = (SELECT private.current_legacy_user_id())
        OR (SELECT private.current_role()) = 'ADMIN'
      )
  )
$$;

CREATE FUNCTION private.participates_in_project(target_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."SyndicatePledge" AS sp
    WHERE sp."projectId" = target_project_id
      AND sp."investorUserId" = (SELECT private.current_legacy_user_id())
      AND sp.status IN ('PLEDGED', 'CONFIRMED')
  )
$$;

CREATE FUNCTION private.can_access_project(target_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."SyndicateProject" AS sp
    WHERE sp.id = target_project_id
      AND (
        (SELECT private.owns_property(sp."propertyId"))
        OR (SELECT private.participates_in_project(sp.id))
        OR (SELECT private.current_role()) = 'ADMIN'
      )
  )
$$;

CREATE FUNCTION private.property_agent_user_id(target_property_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ap."userId"
  FROM public."Property" AS p
  JOIN public."AgentProfile" AS ap ON ap.id = p."agentProfileId"
  WHERE p.id = target_property_id
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO anon, authenticated;

-- RLS is enabled on every exposed public table, including the PostGIS table.
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
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('CREATE POLICY p3_select ON public.%I FOR SELECT TO anon, authenticated USING (false)', table_name);
    EXECUTE format('CREATE POLICY p3_insert ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (false)', table_name);
    EXECUTE format('CREATE POLICY p3_update ON public.%I FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false)', table_name);
    EXECUTE format('CREATE POLICY p3_delete ON public.%I FOR DELETE TO anon, authenticated USING (false)', table_name);
  END LOOP;
END
$phase3$;

-- User: self/admin read only, and only non-secret columns are granted.
ALTER POLICY p3_select ON public."User" TO authenticated
  USING (
    id = (SELECT private.current_legacy_user_id())
    OR (SELECT private.current_role()) = 'ADMIN'
  );
GRANT SELECT (id, email, name, role, "emailVerified", "kycStatus",
  "complianceCode", "avatarUrl", "gdprConsentAt", active, "createdAt")
  ON public."User" TO authenticated;

-- profiles: a user can read their row and edit presentation/consent fields.
-- role, kycStatus, complianceCode, active and legacyUserId have no UPDATE grant.
ALTER POLICY p3_select ON public.profiles TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT private.current_role()) = 'ADMIN');
ALTER POLICY p3_update ON public.profiles TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (name, "avatarUrl", "gdprConsentAt") ON public.profiles TO authenticated;

-- Public marketplace reads. Draft inventory remains visible only to its owner/admin.
ALTER POLICY p3_select ON public."AgentProfile"
  USING (active OR (SELECT private.owns_agent_profile(id)) OR (SELECT private.current_role()) = 'ADMIN');
GRANT SELECT ON public."AgentProfile" TO anon, authenticated;

ALTER POLICY p3_select ON public."Property"
  USING ((SELECT private.can_view_property(id)));
GRANT SELECT ON public."Property" TO anon, authenticated;

ALTER POLICY p3_select ON public."PropertyDistressTag"
  USING ((SELECT private.can_view_property("propertyId")));
GRANT SELECT ON public."PropertyDistressTag" TO anon, authenticated;

ALTER POLICY p3_select ON public."PropertyImage"
  USING ((SELECT private.can_view_property("propertyId")));
GRANT SELECT ON public."PropertyImage" TO anon, authenticated;

ALTER POLICY p3_select ON public."SyndicateProject"
  USING (
    (SELECT private.can_view_property("propertyId"))
    OR (SELECT private.can_access_project(id))
  );
GRANT SELECT ON public."SyndicateProject" TO anon, authenticated;

ALTER POLICY p3_select ON public."CaseStudy"
  USING (EXISTS (
    SELECT 1 FROM public."AgentProfile" AS ap
    WHERE ap.id = "CaseStudy"."agentProfileId" AND ap.active
  ));
GRANT SELECT ON public."CaseStudy" TO anon, authenticated;

ALTER POLICY p3_select ON public."Partner" USING (approved);
GRANT SELECT ON public."Partner" TO anon, authenticated;

ALTER POLICY p3_select ON public."AdSlot"
  USING (active AND EXISTS (
    SELECT 1 FROM public."Partner" AS p
    WHERE p.id = "AdSlot"."partnerId" AND p.approved
  ));
GRANT SELECT ON public."AdSlot" TO anon, authenticated;

ALTER POLICY p3_select ON public."ComparableSale" USING (true);
GRANT SELECT ON public."ComparableSale" TO anon, authenticated;

-- Pledges: only the investor who owns the row (or an admin) can read it.
-- New pledges require the authoritative profile role and APPROVED KYC.
ALTER POLICY p3_select ON public."SyndicatePledge" TO authenticated
  USING (
    "investorUserId" = (SELECT private.current_legacy_user_id())
    OR (SELECT private.current_role()) = 'ADMIN'
  );
ALTER POLICY p3_insert ON public."SyndicatePledge" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'INVESTOR'
    AND (SELECT private.current_kyc_status()) = 'APPROVED'
    AND "investorUserId" = (SELECT private.current_legacy_user_id())
    AND "amountGBP" > 0
    AND status = 'PLEDGED'
    AND EXISTS (
      SELECT 1 FROM public."SyndicateProject" AS project
      WHERE project.id = "SyndicatePledge"."projectId"
        AND project.status = 'OPEN'
    )
  );
ALTER POLICY p3_update ON public."SyndicatePledge" TO authenticated
  USING (
    "investorUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'PLEDGED'
  )
  WITH CHECK (
    "investorUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'WITHDRAWN'
  );
GRANT SELECT ON public."SyndicatePledge" TO authenticated;
GRANT INSERT (id, "projectId", "investorUserId", "amountGBP", status)
  ON public."SyndicatePledge" TO authenticated;
GRANT UPDATE (status) ON public."SyndicatePledge" TO authenticated;

-- Project progress is restricted to participating investors, owning agents and admins.
ALTER POLICY p3_select ON public."Milestone" TO authenticated
  USING ((SELECT private.can_access_project("projectId")));
GRANT SELECT ON public."Milestone" TO authenticated;

ALTER POLICY p3_select ON public."MilestonePhoto" TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."Milestone" AS m
    WHERE m.id = "MilestonePhoto"."milestoneId"
      AND (SELECT private.can_access_project(m."projectId"))
  ));
GRANT SELECT ON public."MilestonePhoto" TO authenticated;

ALTER POLICY p3_select ON public."LedgerEntry" TO authenticated
  USING ((SELECT private.can_access_project("projectId")));
GRANT SELECT ON public."LedgerEntry" TO authenticated;

-- Enquiries are visible to their sender, the listing owner and admins.
ALTER POLICY p3_select ON public."Enquiry" TO authenticated
  USING (
    "fromUserId" = (SELECT private.current_legacy_user_id())
    OR (SELECT private.owns_property("propertyId"))
    OR (SELECT private.current_role()) = 'ADMIN'
  );
ALTER POLICY p3_insert ON public."Enquiry" TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND "fromUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'NEW'
    AND (SELECT private.can_view_property("propertyId"))
  );
ALTER POLICY p3_update ON public."Enquiry" TO authenticated
  USING ((SELECT private.owns_property("propertyId")))
  WITH CHECK ((SELECT private.owns_property("propertyId")));
GRANT SELECT ON public."Enquiry" TO authenticated;
GRANT INSERT (id, "propertyId", "fromUserId", message, status)
  ON public."Enquiry" TO authenticated;
GRANT UPDATE (status) ON public."Enquiry" TO authenticated;

-- Saved items/searches are private to the mapped buyer or investor.
ALTER POLICY p3_select ON public."SavedProperty" TO authenticated
  USING ("userId" = (SELECT private.current_legacy_user_id()));
ALTER POLICY p3_insert ON public."SavedProperty" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) IN ('BUYER', 'INVESTOR')
    AND "userId" = (SELECT private.current_legacy_user_id())
    AND (SELECT private.can_view_property("propertyId"))
  );
ALTER POLICY p3_delete ON public."SavedProperty" TO authenticated
  USING ("userId" = (SELECT private.current_legacy_user_id()));
GRANT SELECT, INSERT, DELETE ON public."SavedProperty" TO authenticated;

ALTER POLICY p3_select ON public."SavedSearch" TO authenticated
  USING ("userId" = (SELECT private.current_legacy_user_id()));
ALTER POLICY p3_insert ON public."SavedSearch" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) IN ('BUYER', 'INVESTOR')
    AND "userId" = (SELECT private.current_legacy_user_id())
  );
ALTER POLICY p3_update ON public."SavedSearch" TO authenticated
  USING ("userId" = (SELECT private.current_legacy_user_id()))
  WITH CHECK ("userId" = (SELECT private.current_legacy_user_id()));
ALTER POLICY p3_delete ON public."SavedSearch" TO authenticated
  USING ("userId" = (SELECT private.current_legacy_user_id()));
GRANT SELECT ON public."SavedSearch" TO authenticated;
GRANT INSERT (id, "userId", name, "paramsJson", "alertsEnabled")
  ON public."SavedSearch" TO authenticated;
GRANT UPDATE (name, "paramsJson", "alertsEnabled") ON public."SavedSearch" TO authenticated;
GRANT DELETE ON public."SavedSearch" TO authenticated;

-- Reviews are private to the reviewer, reviewed agency and admins; creation is
-- limited to a buyer/investor with an existing enquiry or completed deal path.
ALTER POLICY p3_select ON public."Appraisal" TO authenticated
  USING (
    "investorUserId" = (SELECT private.current_legacy_user_id())
    OR (SELECT private.owns_agent_profile("agentProfileId"))
    OR (SELECT private.current_role()) = 'ADMIN'
  );
ALTER POLICY p3_insert ON public."Appraisal" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) IN ('BUYER', 'INVESTOR')
    AND "investorUserId" = (SELECT private.current_legacy_user_id())
    AND rating BETWEEN 1 AND 5
    AND (
      EXISTS (
        SELECT 1 FROM public."Enquiry" AS e
        JOIN public."Property" AS p ON p.id = e."propertyId"
        WHERE e."fromUserId" = "Appraisal"."investorUserId"
          AND p."agentProfileId" = "Appraisal"."agentProfileId"
      )
      OR EXISTS (
        SELECT 1 FROM public."Deal" AS d
        JOIN public."Offer" AS o ON o.id = d."offerId"
        JOIN public."Property" AS p ON p.id = d."propertyId"
        WHERE o."buyerUserId" = "Appraisal"."investorUserId"
          AND p."agentProfileId" = "Appraisal"."agentProfileId"
      )
    )
  );
GRANT SELECT ON public."Appraisal" TO authenticated;
GRANT INSERT (id, "agentProfileId", "investorUserId", rating, review)
  ON public."Appraisal" TO authenticated;

ALTER POLICY p3_select ON public."Subscription" TO authenticated
  USING (
    "agentUserId" = (SELECT private.current_legacy_user_id())
    OR (SELECT private.current_role()) = 'ADMIN'
  );
GRANT SELECT ON public."Subscription" TO authenticated;

ALTER POLICY p3_select ON public."SuccessFee" TO authenticated
  USING (
    (SELECT private.owns_property("propertyId"))
    OR (SELECT private.current_role()) = 'ADMIN'
  );
GRANT SELECT ON public."SuccessFee" TO authenticated;

-- Buyer offers: owner/agent visibility, buyer-only creation and withdrawal.
ALTER POLICY p3_select ON public."Offer" TO authenticated
  USING (
    "buyerUserId" = (SELECT private.current_legacy_user_id())
    OR (SELECT private.owns_property("propertyId"))
    OR (SELECT private.current_role()) = 'ADMIN'
  );
ALTER POLICY p3_insert ON public."Offer" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'BUYER'
    AND "buyerUserId" = (SELECT private.current_legacy_user_id())
    AND "amountGBP" > 0
    AND status = 'SUBMITTED'
    AND (SELECT private.can_view_property("propertyId"))
  );
ALTER POLICY p3_update ON public."Offer" TO authenticated
  USING (
    "buyerUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'SUBMITTED'
  )
  WITH CHECK (
    "buyerUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'WITHDRAWN'
  );
GRANT SELECT ON public."Offer" TO authenticated;
GRANT INSERT (id, "propertyId", "buyerUserId", "amountGBP", status)
  ON public."Offer" TO authenticated;
GRANT UPDATE (status) ON public."Offer" TO authenticated;

ALTER POLICY p3_select ON public."Deal" TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."Offer" AS o
      WHERE o.id = "Deal"."offerId"
        AND o."buyerUserId" = (SELECT private.current_legacy_user_id())
    )
    OR (SELECT private.owns_property("propertyId"))
    OR (SELECT private.current_role()) = 'ADMIN'
  );
GRANT SELECT ON public."Deal" TO authenticated;

ALTER POLICY p3_select ON public."Viewing" TO authenticated
  USING (
    "buyerUserId" = (SELECT private.current_legacy_user_id())
    OR (SELECT private.owns_property("propertyId"))
    OR (SELECT private.current_role()) = 'ADMIN'
  );
ALTER POLICY p3_insert ON public."Viewing" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'BUYER'
    AND "buyerUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'REQUESTED'
    AND "slotStart" > now()
    AND "slotEnd" = "slotStart" + interval '1 hour'
    AND (SELECT private.can_view_property("propertyId"))
  );
GRANT SELECT ON public."Viewing" TO authenticated;
GRANT INSERT (id, "propertyId", "buyerUserId", "slotStart", "slotEnd", status)
  ON public."Viewing" TO authenticated;

-- Chat is limited to the two participants. The recipient must be the listing agent.
ALTER POLICY p3_select ON public."ChatMessage" TO authenticated
  USING (
    "fromUserId" = (SELECT private.current_legacy_user_id())
    OR "toUserId" = (SELECT private.current_legacy_user_id())
  );
ALTER POLICY p3_insert ON public."ChatMessage" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'BUYER'
    AND "fromUserId" = (SELECT private.current_legacy_user_id())
    AND "toUserId" = (SELECT private.property_agent_user_id("propertyId"))
    AND (SELECT private.can_view_property("propertyId"))
  );
ALTER POLICY p3_update ON public."ChatMessage" TO authenticated
  USING ("toUserId" = (SELECT private.current_legacy_user_id()))
  WITH CHECK ("toUserId" = (SELECT private.current_legacy_user_id()));
GRANT SELECT ON public."ChatMessage" TO authenticated;
GRANT INSERT (id, "propertyId", "fromUserId", "toUserId", body)
  ON public."ChatMessage" TO authenticated;
GRANT UPDATE ("readAt") ON public."ChatMessage" TO authenticated;

ALTER POLICY p3_select ON public."AuditLog" TO authenticated
  USING ((SELECT private.current_role()) = 'ADMIN');
GRANT SELECT ON public."AuditLog" TO authenticated;

-- VerificationToken, KycRecord and _prisma_migrations retain
-- four explicit deny policies and no Data API grants. KYC status is exposed
-- only through the caller's own profile; raw provider data stays server-only.

-- PostGIS owns spatial_ref_sys, geography_columns and geometry_columns as the
-- platform-only supabase_admin role. The project role cannot alter those
-- extension members. They are inventoried and treated as managed extension
-- objects rather than application relations.

-- Pin search paths and remove direct RPC execution where it is not required.
ALTER FUNCTION public.property_search_vector_update() SET search_path = '';
REVOKE ALL ON FUNCTION public.property_search_vector_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proplink_create_auth_profile() FROM PUBLIC, anon, authenticated;

-- Storage buckets. KYC is private and immutable through the client. Property
-- images are public for direct asset delivery, but listing/writes still use RLS.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('kyc-documents', 'kyc-documents', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('property-images', 'property-images', true, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON storage.buckets, storage.objects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

CREATE POLICY p3_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    (bucket_id = 'kyc-documents' AND (
      owner_id = (SELECT auth.uid())::text
      OR (SELECT private.current_role()) = 'ADMIN'
    ))
    OR (bucket_id = 'property-images' AND (
      owner_id = (SELECT auth.uid())::text
      OR (SELECT private.current_role()) = 'ADMIN'
    ))
  );

CREATE POLICY p3_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      bucket_id = 'kyc-documents'
      AND (SELECT private.current_role()) = 'INVESTOR'
      AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    )
    OR (
      bucket_id = 'property-images'
      AND (SELECT private.current_role()) = 'AGENT'
      AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    )
  );

CREATE POLICY p3_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (SELECT private.current_role()) = 'AGENT'
    AND owner_id = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'property-images'
    AND (SELECT private.current_role()) = 'AGENT'
    AND owner_id = (SELECT auth.uid())::text
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY p3_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      ((SELECT private.current_role()) = 'AGENT' AND owner_id = (SELECT auth.uid())::text)
      OR (SELECT private.current_role()) = 'ADMIN'
    )
  );

-- Storage's DDL hooks can restore broad table grants while policies are being
-- created. Revoke again as the final statement, then add only required DML.
REVOKE ALL ON storage.buckets, storage.objects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

COMMENT ON SCHEMA private IS
  'Not exposed through the Data API; contains hardened RLS authorization helpers.';
