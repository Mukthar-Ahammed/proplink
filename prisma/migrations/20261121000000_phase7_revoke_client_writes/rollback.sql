-- Rollback for 20261121000000_phase7_revoke_client_writes (ADR-063): restores
-- the client write and User read grants exactly as they were before.
GRANT INSERT ("agentProfileId", id, "investorUserId", rating, review) ON public."Appraisal" TO authenticated;
GRANT INSERT (body, "fromUserId", id, "propertyId", "toUserId") ON public."ChatMessage" TO authenticated;
GRANT UPDATE ("readAt") ON public."ChatMessage" TO authenticated;
GRANT INSERT ("fromUserId", id, message, "propertyId", status) ON public."Enquiry" TO authenticated;
GRANT UPDATE (status) ON public."Enquiry" TO authenticated;
GRANT INSERT ("amountGBP", "buyerUserId", id, "propertyId", status) ON public."Offer" TO authenticated;
GRANT UPDATE (status) ON public."Offer" TO authenticated;
GRANT INSERT ("alertsEnabled", id, name, "paramsJson", "userId") ON public."SavedSearch" TO authenticated;
GRANT UPDATE ("alertsEnabled", name, "paramsJson") ON public."SavedSearch" TO authenticated;
GRANT INSERT ("buyerUserId", id, "propertyId", "slotEnd", "slotStart", status) ON public."Viewing" TO authenticated;
GRANT UPDATE ("avatarUrl", "gdprConsentAt", name) ON public.profiles TO authenticated;
GRANT SELECT (active, "avatarUrl", "complianceCode", "createdAt", email, "emailVerified", "gdprConsentAt", id, "kycStatus", name, role) ON public."User" TO authenticated;
GRANT INSERT, DELETE ON public."SavedProperty" TO authenticated;
GRANT DELETE ON public."SavedSearch" TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
