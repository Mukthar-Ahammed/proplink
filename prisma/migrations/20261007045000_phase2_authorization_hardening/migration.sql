-- Phase 2: authorization, public-boundary and unfinished-feature hardening.
-- This migration builds on the Phase 0.5 identity-consistency helpers and the
-- Phase 1 server-controlled profiles.investorType column.

CREATE FUNCTION private.current_investor_type()
RETURNS public."InvestorType"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p."investorType"
  FROM public.profiles AS p
  JOIN public."User" AS u ON u.id = p."legacyUserId"
  WHERE p.id = (SELECT auth.uid())
    AND p.active
    AND u.active
    AND p.role = u.role
    AND p."kycStatus" = u."kycStatus"
    AND p.role = 'INVESTOR'::public."Role"
$$;

REVOKE ALL ON FUNCTION private.current_investor_type() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_investor_type() TO anon, authenticated;

-- Public inventory must belong to an active AgentProfile and active Agent
-- account. Owners and Admin retain explicit non-public preview access.
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
    LEFT JOIN public."User" AS agent_user ON agent_user.id = ap."userId"
    WHERE p.id = target_property_id
      AND (
        (
          p.status IN ('LIVE', 'UNDER_OFFER', 'SOLD')
          AND ap.active
          AND agent_user.active
        )
        OR ap."userId" = (SELECT private.current_legacy_user_id())
        OR (SELECT private.current_role()) = 'ADMIN'
      )
  )
$$;

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
  JOIN public."User" AS agent_user ON agent_user.id = ap."userId"
  WHERE p.id = target_property_id
    AND ap.active
    AND agent_user.active
$$;

ALTER POLICY p3_select ON public."AgentProfile"
  USING (
    (
      active
      AND EXISTS (
        SELECT 1
        FROM public."User" AS agent_user
        WHERE agent_user.id = "AgentProfile"."userId"
          AND agent_user.active
      )
    )
    OR (SELECT private.owns_agent_profile(id))
    OR (SELECT private.current_role()) = 'ADMIN'
  );

ALTER POLICY p3_select ON public."CaseStudy"
  USING (EXISTS (
    SELECT 1
    FROM public."AgentProfile" AS ap
    JOIN public."User" AS agent_user ON agent_user.id = ap."userId"
    WHERE ap.id = "CaseStudy"."agentProfileId"
      AND ap.active
      AND agent_user.active
  ));

-- Current enquiries are a Buyer workflow. The actor is mapped through the
-- fail-closed Profile/User identity helpers and the property must be public.
ALTER POLICY p3_insert ON public."Enquiry" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'BUYER'
    AND "fromUserId" = (SELECT private.current_legacy_user_id())
    AND status = 'NEW'
    AND (SELECT private.can_view_property("propertyId"))
  );

-- Pledge creation/update is not implemented in Phase 2. Keep reads restricted
-- to eligible syndicate-capable owners (or Admin governance) and deny writes.
ALTER POLICY p3_select ON public."SyndicatePledge" TO authenticated
  USING (
    (
      "investorUserId" = (SELECT private.current_legacy_user_id())
      AND (SELECT private.current_role()) = 'INVESTOR'
      AND (SELECT private.current_investor_type()) IN ('SYNDICATE', 'BOTH')
    )
    OR (SELECT private.current_role()) = 'ADMIN'
  );

ALTER POLICY p3_insert ON public."SyndicatePledge" TO authenticated
  WITH CHECK (false);
ALTER POLICY p3_update ON public."SyndicatePledge" TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE INSERT, UPDATE ON public."SyndicatePledge" FROM authenticated;

-- A Buyer may only start a property-scoped conversation with that active
-- property's responsible Agent. Thread reads remain exact-participant only.
ALTER POLICY p3_insert ON public."ChatMessage" TO authenticated
  WITH CHECK (
    (SELECT private.current_role()) = 'BUYER'
    AND "fromUserId" = (SELECT private.current_legacy_user_id())
    AND "toUserId" = (SELECT private.property_agent_user_id("propertyId"))
    AND (SELECT private.can_view_property("propertyId"))
  );

-- KYC upload UI/workflow does not exist yet. The private bucket may be read by
-- its exact owner/Admin, but client-side KYC writes remain disabled. Property
-- media retains its Agent-owned UUID folder rule.
ALTER POLICY p3_storage_insert ON storage.objects
  WITH CHECK (
    bucket_id = 'property-images'
    AND (SELECT private.current_role()) = 'AGENT'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

COMMENT ON FUNCTION private.current_investor_type() IS
  'Returns the server-controlled Investor subtype only for an active, consistent mapped identity.';

