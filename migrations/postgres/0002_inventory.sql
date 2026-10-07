-- Additive migration. Run after 0001 using a migration owner, never the API login.
BEGIN;
SELECT pg_advisory_xact_lock(70631007);
CREATE SCHEMA inventory;
REVOKE ALL ON SCHEMA inventory FROM PUBLIC;
CREATE TABLE inventory.schema_version (version integer PRIMARY KEY);
INSERT INTO inventory.schema_version VALUES (1);

CREATE TABLE inventory.components (
  id text PRIMARY KEY, ecosystem text NOT NULL, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(ecosystem,name)
);
CREATE TABLE inventory.releases (
  id text PRIMARY KEY, component_id text NOT NULL REFERENCES inventory.components(id),
  version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(component_id,version), UNIQUE(component_id,id)
);
-- A deployment groups related endpoints. Grouping is explicit, never inferred
-- from a common domain/CDN/IP or from a shared technology fingerprint.
CREATE TABLE inventory.deployments (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES console.campaigns(id),
  name text NOT NULL, environment text NOT NULL DEFAULT 'unknown',
  created_by text NOT NULL REFERENCES console.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,id), UNIQUE(campaign_id,name,environment)
);
CREATE TABLE inventory.assets (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES console.campaigns(id),
  deployment_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('domain','url','app','repo','cidr','other')),
  value text NOT NULL, subtype text, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(campaign_id,deployment_id) REFERENCES inventory.deployments(campaign_id,id),
  UNIQUE(campaign_id,deployment_id,kind,value)
);
CREATE TABLE inventory.fingerprints (
  id text PRIMARY KEY, campaign_id text NOT NULL, deployment_id text NOT NULL,
  component_id text NOT NULL REFERENCES inventory.components(id), release_id text,
  version_range text, presence text NOT NULL CHECK(presence IN ('present','absent')),
  source_key text NOT NULL, method text NOT NULL, confidence double precision NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL, configuration jsonb NOT NULL DEFAULT '{}',
  observed_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  event_key text NOT NULL, input_hash text NOT NULL, state_hash text NOT NULL,
  recorded_by text NOT NULL REFERENCES console.users(id), worker_id text,
  allow_advisory_lookup boolean NOT NULL DEFAULT false,
  FOREIGN KEY(campaign_id,deployment_id) REFERENCES inventory.deployments(campaign_id,id),
  FOREIGN KEY(component_id,release_id) REFERENCES inventory.releases(component_id,id),
  UNIQUE(campaign_id,event_key)
);
CREATE INDEX fingerprint_latest ON inventory.fingerprints(deployment_id,component_id,source_key,observed_at DESC,received_at DESC);
CREATE VIEW inventory.current_fingerprints AS
  SELECT DISTINCT ON (deployment_id,component_id,source_key) * FROM inventory.fingerprints
  ORDER BY deployment_id,component_id,source_key,observed_at DESC,received_at DESC,id DESC;

CREATE TABLE inventory.advisory_revisions (
  id text PRIMARY KEY, advisory_id text NOT NULL, modified_at timestamptz NOT NULL,
  document jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory.advisories (
  id text PRIMARY KEY, revision_id text NOT NULL REFERENCES inventory.advisory_revisions(id),
  modified_at timestamptz NOT NULL, last_checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory.advisory_components (
  advisory_id text NOT NULL REFERENCES inventory.advisories(id), component_id text NOT NULL REFERENCES inventory.components(id),
  PRIMARY KEY(advisory_id,component_id)
);
CREATE TABLE inventory.assessments (
  id text PRIMARY KEY, campaign_id text NOT NULL, deployment_id text NOT NULL,
  component_id text NOT NULL REFERENCES inventory.components(id), advisory_id text NOT NULL REFERENCES inventory.advisories(id),
  revision_id text NOT NULL REFERENCES inventory.advisory_revisions(id),
  match_state text NOT NULL CHECK(match_state IN ('affected_version','possible','not_affected','withdrawn')),
  input_hash text NOT NULL, rationale jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(campaign_id,deployment_id) REFERENCES inventory.deployments(campaign_id,id),
  UNIQUE(deployment_id,component_id,advisory_id), UNIQUE(campaign_id,id)
);
CREATE TABLE inventory.assessment_history (
  id text PRIMARY KEY, assessment_id text NOT NULL REFERENCES inventory.assessments(id),
  input_hash text NOT NULL, match_state text NOT NULL, rationale jsonb NOT NULL,
  revision_id text NOT NULL REFERENCES inventory.advisory_revisions(id), recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory.reviews (
  id text PRIMARY KEY, campaign_id text NOT NULL, assessment_id text NOT NULL, input_hash text NOT NULL,
  verdict text NOT NULL CHECK(verdict IN ('confirmed','not_affected','needs_information')),
  reason text NOT NULL, evidence jsonb NOT NULL, actor_id text NOT NULL REFERENCES console.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(campaign_id,assessment_id) REFERENCES inventory.assessments(campaign_id,id)
);
CREATE TABLE inventory.events (
  id bigserial PRIMARY KEY, campaign_id text NOT NULL REFERENCES console.campaigns(id),
  kind text NOT NULL, subject_id text NOT NULL, data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_events_campaign ON inventory.events(campaign_id,id);
CREATE TABLE inventory.event_receipts (
  user_id text NOT NULL REFERENCES console.users(id), event_id bigint NOT NULL REFERENCES inventory.events(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,event_id)
);
CREATE TABLE inventory.worker_tokens (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES console.campaigns(id),
  token_hash text UNIQUE NOT NULL, name text NOT NULL, capabilities jsonb NOT NULL,
  created_by text NOT NULL REFERENCES console.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
ALTER TABLE inventory.fingerprints ADD FOREIGN KEY(worker_id) REFERENCES inventory.worker_tokens(id);
CREATE TABLE inventory.research_tasks (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES console.campaigns(id),
  component_id text NOT NULL REFERENCES inventory.components(id), release_id text NOT NULL,
  hypothesis text NOT NULL, source_revision text NOT NULL, source_url text NOT NULL,
  budget_minutes integer NOT NULL CHECK(budget_minutes BETWEEN 1 AND 240),
  state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','running','completed','failed','cancelled')),
  created_by text NOT NULL REFERENCES console.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL, attempt integer NOT NULL DEFAULT 0, lease_token text,
  lease_until timestamptz, worker_id text REFERENCES inventory.worker_tokens(id),
  result jsonb, completed_at timestamptz,
  FOREIGN KEY(component_id,release_id) REFERENCES inventory.releases(component_id,id),
  UNIQUE(campaign_id,dedupe_key)
);
CREATE TABLE inventory.research_attempts (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES inventory.research_tasks(id), attempt integer NOT NULL,
  worker_id text NOT NULL REFERENCES inventory.worker_tokens(id), started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz, outcome text, result jsonb, UNIQUE(task_id,attempt)
);
CREATE TABLE inventory.worker_health (
  name text PRIMARY KEY, last_started_at timestamptz, last_success_at timestamptz,
  status text NOT NULL, detail text
);

CREATE FUNCTION inventory.reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inventory evidence is append-only' USING ERRCODE='55000'; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fingerprints','advisory_revisions','assessment_history','reviews','events'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON inventory.%I FOR EACH ROW EXECUTE FUNCTION inventory.reject_evidence_mutation()',t);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA inventory FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA inventory FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA inventory FROM PUBLIC;
-- Existing trusted API identity only. Agents use revocable campaign-scoped HTTP
-- tokens; they never receive this identity or direct database credentials.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='console_api') THEN
    GRANT USAGE ON SCHEMA inventory TO console_api;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA inventory TO console_api;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA inventory TO console_api;
    REVOKE UPDATE,DELETE ON inventory.fingerprints,inventory.advisory_revisions,inventory.assessment_history,inventory.reviews,inventory.events FROM console_api;
    REVOKE INSERT,UPDATE,DELETE ON inventory.schema_version FROM console_api;
  END IF;
END $$;
COMMIT;
