-- Phase 3 advisor remediation: cover every foreign key reported by the
-- Supabase performance advisor. Existing purpose-built indexes are retained.

CREATE INDEX "AdSlot_partnerId_idx" ON public."AdSlot"("partnerId");
CREATE INDEX "Appraisal_investorUserId_idx" ON public."Appraisal"("investorUserId");
CREATE INDEX "AuditLog_actorUserId_idx" ON public."AuditLog"("actorUserId");
CREATE INDEX "ChatMessage_fromUserId_idx" ON public."ChatMessage"("fromUserId");
CREATE INDEX "Deal_offerId_idx" ON public."Deal"("offerId");
CREATE INDEX "Deal_propertyId_idx" ON public."Deal"("propertyId");
CREATE INDEX "LedgerEntry_createdBy_idx" ON public."LedgerEntry"("createdBy");
CREATE INDEX "MilestonePhoto_milestoneId_idx" ON public."MilestonePhoto"("milestoneId");
CREATE INDEX "Offer_buyerUserId_idx" ON public."Offer"("buyerUserId");
CREATE INDEX "SavedProperty_propertyId_idx" ON public."SavedProperty"("propertyId");
CREATE INDEX "SuccessFee_projectId_idx" ON public."SuccessFee"("projectId");
CREATE INDEX "SuccessFee_propertyId_idx" ON public."SuccessFee"("propertyId");
CREATE INDEX "SyndicateProject_propertyId_idx" ON public."SyndicateProject"("propertyId");
CREATE INDEX "Viewing_buyerUserId_idx" ON public."Viewing"("buyerUserId");
