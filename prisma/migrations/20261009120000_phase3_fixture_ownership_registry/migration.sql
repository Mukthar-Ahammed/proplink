CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.phase3_fixture_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_ref text NOT NULL,
  run_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_key jsonb NOT NULL,
  resource_id text NOT NULL,
  owner_auth_user_id uuid NOT NULL,
  owner_legacy_user_id text NOT NULL,
  parent_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('PLANNED','VERIFIED','FAILED','NEEDS_RECONCILIATION')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  UNIQUE (project_ref, run_id, resource_type, resource_key),
  UNIQUE (project_ref, resource_type, resource_id)
);

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.phase3_fixture_resources FROM PUBLIC, anon, authenticated;
