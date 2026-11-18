-- Rollback for 20261118120000_phase2_agent_proposals.
-- Agent proposals and their questions and answers are lost. Audit rows
-- (AGENT_PROPOSAL_*) remain.
DROP TABLE IF EXISTS public.agent_proposal_questions;
DROP TABLE IF EXISTS public.agent_proposals;
DROP FUNCTION IF EXISTS public.proplink_agent_proposal_question_guard();
DROP FUNCTION IF EXISTS public.proplink_agent_proposal_guard();
DROP TYPE IF EXISTS public."AgentProposalFeeType";
DROP TYPE IF EXISTS public."AgentProposalStatus";
