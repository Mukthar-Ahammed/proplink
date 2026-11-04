-- Roll back only the Phase 2 authorization hardening, restoring the policies
-- and helper definitions that existed immediately after Phase 1.

ALTER POLICY p3_storage_insert ON storage.objects
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

ALTER POLICY p3_insert ON public."ChatMessage" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'BUYER'
    AND "fromUserId" = (SELECT private.current_legacy_user_id())
    AND "toUserId" = (SELECT private.property_agent_user_id("propertyId"))
    AND (SELECT private.can_view_property("propertyId"))
  );

GRANT INSERT (id, "projectId", "investorUserId", "amountGBP", status)
  ON public."SyndicatePledge" TO authenticated;
GRANT UPDATE (status) ON public."SyndicatePledge" TO authenticated;

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

ALTER POLICY p3_insert ON public."Enquiry" TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND "fromUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'NEW'
    AND (SELECT private.can_view_property("propertyId"))
  );

ALTER POLICY p3_select ON public."CaseStudy"
  USING (EXISTS (
    SELECT 1 FROM public."AgentProfile" AS ap
    WHERE ap.id = "CaseStudy"."agentProfileId" AND ap.active
  ));

ALTER POLICY p3_select ON public."AgentProfile"
  USING (active OR (SELECT private.owns_agent_profile(id)) OR (SELECT private.current_role()) = 'ADMIN');

CREATE OR REPLACE FUNCTION private.property_agent_user_id(target_property_id text)
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

CREATE OR REPLACE FUNCTION private.can_view_property(target_property_id text)
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

DROP FUNCTION private.current_investor_type();

