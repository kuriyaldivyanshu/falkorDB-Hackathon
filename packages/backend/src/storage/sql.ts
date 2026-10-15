/**
 * Core bootstrap migration (version 1).
 *
 * Derived from `archive/plans/schema/postgresql-core-reference.sql`, the
 * reviewed 31-table FK-closed core reference. Two things are deliberately not
 * copied from it:
 *
 * - the reference's outer `BEGIN`/`COMMIT`, `SET LOCAL search_path` and
 *   `CREATE SCHEMA`, because the migration runner owns transaction control,
 *   establishes the search path and creates the schema before it records its
 *   own bookkeeping row inside the same transaction;
 * - the `CREATE TABLE schema_migrations` statement itself, because the runner
 *   creates that table first (the reference declares it late in its body) and
 *   nothing in the model references it, so removing it keeps the core FK-closed
 *   over the remaining 30 domain tables;
 * - the `native_bindings` and `provider_oauth_registrations` tables, which stay
 *   deferred extension tables and are not startup requirements.
 *
 * The SQL lives in a TypeScript module rather than a `.sql` file so that the
 * compiled `dist` tree is self-contained and the migration cannot go missing at
 * runtime. Its checksum is recorded in `threadline.schema_migrations`; a
 * mismatch with the recorded checksum is reported as `schema_incompatible`
 * rather than silently reapplied.
 */

export const CORE_BOOTSTRAP_VERSION = 1;

export const CORE_BOOTSTRAP_SQL = String.raw`


-- Human account; local bootstrap or future federated identity [core]
CREATE TABLE users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','disabled','deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Federated/local subject mapping; never provider inference credentials [core]
CREATE TABLE auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  issuer text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

-- Isolation boundary and account namespace [core]
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','suspended','deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Human membership and role in one tenant [core]
CREATE TABLE tenant_memberships (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  status text NOT NULL CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Trusted graph routing and project lifecycle [core]
CREATE TABLE projects (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  graph_key text NOT NULL UNIQUE,
  graph_epoch uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('initializing','ready','paused','archived','deleted')),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Project role; tenant membership is a prerequisite [core]
CREATE TABLE project_memberships (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','editor','reviewer','viewer')),
  status text NOT NULL CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Human application authentication; distinct from agent sessions [core]
CREATE TABLE user_sessions (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  auth_method text NOT NULL CHECK (auth_method IN ('local_bootstrap','oidc')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  client_label text NOT NULL,
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (expires_at > created_at),
  CHECK (idle_expires_at <= expires_at),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE (tenant_id, user_id, id)
);
CREATE INDEX user_sessions_lookup_1 ON user_sessions (tenant_id, user_id, expires_at);

-- Enrolled execution host; local first [core]
CREATE TABLE worker_hosts (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  credential_hash char(64) NOT NULL UNIQUE,
  credential_expires_at timestamptz NOT NULL,
  boot_id uuid NOT NULL,
  allowed_roots jsonb NOT NULL,
  capabilities jsonb NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Nonsecret native or API route metadata for one human [core]
CREATE TABLE provider_accounts (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  runtime text NOT NULL,
  auth_route text NOT NULL CHECK (auth_route IN ('native','api_key','chatgpt_plan_oauth','cloud_identity','local')),
  label text NOT NULL,
  secret_ref text,
  native_profile_ref text,
  last_probe_at timestamptz,
  probe_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK (auth_route <> 'native' OR secret_ref IS NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Project-selectable versioned execution settings [core]
CREATE TABLE provider_profiles (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  name text NOT NULL,
  model_id text NOT NULL,
  adapter_version text NOT NULL,
  effort text,
  settings jsonb NOT NULL,
  config_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, owner_user_id, provider_account_id) REFERENCES provider_accounts(tenant_id, user_id, id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Authorized worktree/snapshot binding to a project and host [core]
CREATE TABLE workspace_registrations (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  host_id uuid NOT NULL,
  canonical_path text NOT NULL,
  repository_fingerprint char(64) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('builder','verifier','fixture')),
  status text NOT NULL CHECK (status IN ('registered','active','quarantined','retired')),
  base_commit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, host_id) REFERENCES worker_hosts(tenant_id, id),
  UNIQUE (tenant_id, host_id, canonical_path),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Run index and immutable admitted policy; current authority in graph Run [core]
CREATE TABLE runs (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  initiated_by uuid NOT NULL,
  initial_profile_id uuid NOT NULL,
  policy jsonb NOT NULL,
  policy_digest char(64) NOT NULL,
  observed_status text NOT NULL,
  projected_epoch uuid,
  projected_seq bigint CHECK (projected_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (tenant_id, project_id, initial_profile_id) REFERENCES provider_profiles(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, initiated_by) REFERENCES project_memberships(tenant_id, project_id, user_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- One actual runtime instance; fresh successors get new identities [core]
CREATE TABLE agent_sessions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  task_graph_id uuid NOT NULL,
  parent_session_id uuid,
  profile_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('builder','verifier')),
  authorization_kind text NOT NULL CHECK (authorization_kind IN ('task_claim','verification_assignment','investigation_assignment')),
  authorization_manifest jsonb NOT NULL,
  authorization_digest char(64) NOT NULL,
  runtime_status text NOT NULL,
  capture_seq bigint NOT NULL DEFAULT 0 CHECK (capture_seq >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, run_id) REFERENCES runs(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, profile_id) REFERENCES provider_profiles(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, workspace_id) REFERENCES workspace_registrations(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, run_id, id),
  FOREIGN KEY (tenant_id, project_id, run_id, parent_session_id) REFERENCES agent_sessions(tenant_id, project_id, run_id, id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);


-- Observed runtime registration attempts; process identity only for actual external runtime [core]
CREATE TABLE launch_attempts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  launch_graph_id uuid NOT NULL,
  host_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  process_id bigint,
  process_start_identity text,
  status text NOT NULL CHECK (status IN ('starting','registered','failed','unknown','terminated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, host_id) REFERENCES worker_hosts(tenant_id, id),
  UNIQUE (tenant_id, project_id, launch_graph_id, attempt_no),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Immutable content metadata; bytes are project-scoped external objects [core]
CREATE TABLE artifacts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  content_digest char(64) NOT NULL,
  storage_key text NOT NULL,
  kind text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  visibility text NOT NULL CHECK (visibility IN ('project','user','session')),
  owner_user_id uuid,
  owner_session_id uuid,
  status text NOT NULL CHECK (status IN ('available','missing','tombstoned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, owner_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK ((visibility='project') OR (visibility='user' AND owner_user_id IS NOT NULL) OR (visibility='session' AND owner_session_id IS NOT NULL)),
  UNIQUE (tenant_id, project_id, storage_key),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Immutable normalized visible observation, authoritative before graph ingestion [core]
CREATE TABLE capture_events (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  source_key text NOT NULL,
  capture_seq bigint NOT NULL CHECK (capture_seq > 0),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  payload_digest char(64) NOT NULL,
  raw_artifact_id uuid,
  observed_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, raw_artifact_id) REFERENCES artifacts(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, agent_session_id, source_key),
  UNIQUE (tenant_id, project_id, agent_session_id, capture_seq),
  UNIQUE (tenant_id, project_id, agent_session_id, id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
CREATE INDEX capture_events_lookup_1 ON capture_events (tenant_id, project_id, agent_session_id, capture_seq);

-- Ordered visible user/assistant/tool text; graph Message anchors cite these [core]
CREATE TABLE session_messages (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  capture_event_id uuid NOT NULL,
  message_seq bigint NOT NULL CHECK (message_seq > 0),
  role text NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  body text,
  body_artifact_id uuid,
  body_digest char(64) NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('project','user','session')),
  owner_user_id uuid,
  is_partial boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, agent_session_id, capture_event_id) REFERENCES capture_events(tenant_id, project_id, agent_session_id, id),
  FOREIGN KEY (tenant_id, project_id, body_artifact_id) REFERENCES artifacts(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  CHECK ((body IS NULL) <> (body_artifact_id IS NULL)),
  CHECK (visibility <> 'user' OR owner_user_id IS NOT NULL),
  UNIQUE (tenant_id, project_id, agent_session_id, message_seq),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Observed external tool action and effect certainty [core]
CREATE TABLE tool_executions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  capture_event_id uuid NOT NULL,
  runtime_call_id text NOT NULL,
  tool_name text NOT NULL,
  input_digest char(64) NOT NULL,
  input_artifact_id uuid,
  output_artifact_id uuid,
  status text NOT NULL CHECK (status IN ('requested','running','succeeded','failed','denied','unknown')),
  exit_code integer,
  candidate_digest char(64),
  started_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, agent_session_id, capture_event_id) REFERENCES capture_events(tenant_id, project_id, agent_session_id, id),
  FOREIGN KEY (tenant_id, project_id, input_artifact_id) REFERENCES artifacts(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, output_artifact_id) REFERENCES artifacts(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, agent_session_id, runtime_call_id),
  UNIQUE (tenant_id, project_id, agent_session_id, id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- One scoped native approval request and user response [core]
CREATE TABLE tool_approvals (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  runtime_request_id text NOT NULL,
  tool_execution_id uuid,
  request_digest char(64) NOT NULL,
  request_payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','denied','expired','cancelled')),
  decided_by uuid,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, agent_session_id, tool_execution_id) REFERENCES tool_executions(tenant_id, project_id, agent_session_id, id),
  FOREIGN KEY (tenant_id, project_id, decided_by) REFERENCES project_memberships(tenant_id, project_id, user_id),
  UNIQUE (tenant_id, project_id, agent_session_id, runtime_request_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Explicit unobserved interval; never synthesize missing content [core]
CREATE TABLE capture_gaps (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  from_seq bigint NOT NULL CHECK (from_seq >= 0),
  to_seq bigint,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','reconciled','unrecoverable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  CHECK (to_seq IS NULL OR to_seq >= from_seq),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- SQL-to-graph delivery; payload resides in capture event [core]
CREATE TABLE capture_outbox (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  capture_event_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  request_digest char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','leased','committed','quarantined')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  graph_epoch uuid,
  graph_event_seq bigint,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, capture_event_id) REFERENCES capture_events(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, capture_event_id),
  UNIQUE (tenant_id, project_id, operation_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
CREATE INDEX capture_outbox_lookup_1 ON capture_outbox (status, next_attempt_at);

-- Replayable SQL copy of committed graph Events [core]
CREATE TABLE graph_event_projection (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  graph_epoch uuid NOT NULL,
  event_seq bigint NOT NULL CHECK (event_seq > 0),
  event_graph_id uuid NOT NULL,
  kind text NOT NULL,
  aggregate_graph_id uuid NOT NULL,
  payload jsonb NOT NULL,
  payload_digest char(64) NOT NULL,
  committed_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, graph_epoch, event_seq),
  UNIQUE (tenant_id, project_id, graph_epoch, event_graph_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Cursor advanced atomically with projection rows [core]
CREATE TABLE projection_offsets (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  consumer_name text NOT NULL,
  graph_epoch uuid NOT NULL,
  last_contiguous_seq bigint NOT NULL CHECK (last_contiguous_seq >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, consumer_name),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Immutable rendered packet; graph ContextPacket owns inclusion relationships [core]
CREATE TABLE context_packets (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  task_graph_id uuid NOT NULL,
  graph_epoch uuid NOT NULL,
  task_revision bigint NOT NULL CHECK (task_revision >= 0),
  requirement_revision bigint NOT NULL CHECK (requirement_revision >= 0),
  graph_generation bigint NOT NULL CHECK (graph_generation >= 0),
  content_artifact_id uuid NOT NULL,
  content_digest char(64) NOT NULL,
  token_count integer NOT NULL CHECK (token_count >= 0),
  count_precision text NOT NULL CHECK (count_precision IN ('exact','estimated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, content_artifact_id) REFERENCES artifacts(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Transport insertion evidence; graph ACK is acceptance authority [core]
CREATE TABLE context_deliveries (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  context_packet_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  runtime_turn_id text,
  status text NOT NULL CHECK (status IN ('staged','submitted','acknowledged','unknown','failed')),
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  graph_ack_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, context_packet_id) REFERENCES context_packets(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, agent_session_id, submission_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Observed usage; graph owns admission/reservations [core]
CREATE TABLE usage_ledger (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  source_key text NOT NULL,
  input_tokens bigint CHECK (input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  cost_microunits bigint CHECK (cost_microunits >= 0),
  currency char(3),
  precision text NOT NULL CHECK (precision IN ('reported','estimated','unknown')),
  reservation_graph_id uuid,
  observed_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, agent_session_id, source_key),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

-- Security/configuration audit; exclude secrets and full private prompts [core]
CREATE TABLE audit_events (
  tenant_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  actor_user_id uuid,
  kind text NOT NULL,
  target_id uuid,
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX audit_events_lookup_1 ON audit_events (tenant_id, created_at);

-- Reference migration inventory; application and graph compatibility checked separately [core]

-- Human goals and requirement changes captured independently of agent execution [core]
CREATE TABLE project_messages (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  author_user_id uuid NOT NULL,
  user_session_id uuid NOT NULL,
  run_id uuid,
  request_id uuid NOT NULL,
  body text NOT NULL,
  body_digest char(64) NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('project','user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, author_user_id) REFERENCES project_memberships(tenant_id, project_id, user_id),
  FOREIGN KEY (tenant_id, author_user_id, user_session_id) REFERENCES user_sessions(tenant_id, user_id, id),
  FOREIGN KEY (tenant_id, project_id, run_id) REFERENCES runs(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, request_id),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);


-- Durable human command envelope and graph-admission retry journal [core]
CREATE TABLE command_inbox (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  initiated_by uuid NOT NULL,
  user_session_id uuid NOT NULL,
  source_message_id uuid,
  request_id uuid NOT NULL,
  graph_epoch uuid NOT NULL,
  operation text NOT NULL,
  payload jsonb NOT NULL,
  request_digest char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','leased','committed','rejected','quarantined')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  graph_receipt_id uuid,
  graph_event_seq bigint CHECK (graph_event_seq > 0),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  FOREIGN KEY (tenant_id, project_id, initiated_by) REFERENCES project_memberships(tenant_id, project_id, user_id),
  FOREIGN KEY (tenant_id, initiated_by, user_session_id) REFERENCES user_sessions(tenant_id, user_id, id),
  FOREIGN KEY (tenant_id, project_id, source_message_id) REFERENCES project_messages(tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, request_id),
  CHECK (status <> 'committed' OR (graph_receipt_id IS NOT NULL AND graph_event_seq IS NOT NULL AND settled_at IS NOT NULL)),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
CREATE INDEX command_inbox_lookup_1 ON command_inbox (tenant_id, project_id, status, next_attempt_at);

-- One durable provider transport attempt within a stable logical turn [core]
CREATE TABLE model_requests (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  agent_session_id uuid NOT NULL,
  logical_request_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  profile_id uuid NOT NULL,
  context_packet_id uuid,
  input_artifact_id uuid NOT NULL,
  input_digest char(64) NOT NULL,
  profile_digest char(64) NOT NULL,
  graph_epoch uuid NOT NULL,
  requirement_revision bigint NOT NULL CHECK (requirement_revision >= 0),
  reservation_graph_id uuid NOT NULL,
  provider_request_id text,
  status text NOT NULL CHECK (status IN ('prepared','dispatched','streaming','completed','failed','unknown','cancelled')),
  response_artifact_id uuid,
  usage_source_key text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY (tenant_id, project_id, agent_session_id) REFERENCES agent_sessions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, profile_id) REFERENCES provider_profiles(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, context_packet_id) REFERENCES context_packets(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, input_artifact_id) REFERENCES artifacts(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, response_artifact_id) REFERENCES artifacts(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, agent_session_id, usage_source_key) REFERENCES usage_ledger(tenant_id, project_id, agent_session_id, source_key),
  UNIQUE (tenant_id, project_id, agent_session_id, logical_request_id, attempt_no),
  CHECK (status <> 'completed' OR (response_artifact_id IS NOT NULL AND finished_at IS NOT NULL)),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
CREATE INDEX model_requests_lookup_1 ON model_requests (tenant_id, project_id, agent_session_id, status);

-- Tenant fences: trusted app transaction SET LOCAL threadline.tenant_id.
-- Service checks active project membership and private-source visibility before every operation.
-- Non-owner app role must not have BYPASSRLS. Auth lookup has a separate narrowly scoped role.
-- No grants are made here; ordinary roles have no access until deployment defines grants.
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON tenant_memberships USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON projects USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON project_memberships USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON user_sessions USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE worker_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_hosts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON worker_hosts USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON provider_accounts USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON provider_profiles USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE workspace_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON workspace_registrations USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON runs USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON agent_sessions USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE launch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE launch_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON launch_attempts USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON artifacts USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE capture_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON capture_events USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON session_messages USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON tool_executions USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE tool_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON tool_approvals USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE capture_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_gaps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON capture_gaps USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE capture_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON capture_outbox USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE graph_event_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_event_projection FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON graph_event_projection USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE projection_offsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection_offsets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON projection_offsets USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE context_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_packets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON context_packets USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE context_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON context_deliveries USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON usage_ledger USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON audit_events USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE project_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON project_messages USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE command_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON command_inbox USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);
ALTER TABLE model_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON model_requests USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);

-- Global users/auth_identities/tenants/schema_migrations require explicit repository-specific grants.
-- Migration owner MUST NOT be the ordinary app role.

-- Session lookup happens before a tenant is known, and user_sessions is
-- tenant-scoped with FORCE row-level security. A SECURITY DEFINER resolver is
-- the narrow exception the reference anticipates ("auth lookup has a separate
-- narrowly scoped role"): it exposes exactly one row for one token digest and
-- nothing else, and it is granted EXECUTE - never table access - to the
-- application role.
CREATE FUNCTION threadline.session_by_token_hash(p_token_hash char(64))
RETURNS TABLE (
  session_id uuid,
  tenant_id uuid,
  user_id uuid,
  display_name text,
  tenant_slug text,
  expires_at timestamptz,
  idle_expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = threadline, pg_catalog
AS $$
  SELECT s.id, s.tenant_id, s.user_id, u.display_name, t.slug, s.expires_at, s.idle_expires_at
    FROM threadline.user_sessions s
    JOIN threadline.users u ON u.id = s.user_id
    JOIN threadline.tenants t ON t.id = s.tenant_id
   WHERE s.token_hash = p_token_hash;
$$;
REVOKE ALL ON FUNCTION threadline.session_by_token_hash(char(64)) FROM PUBLIC;
`;

/**
 * Migration bookkeeping. Created before version 1 is applied because the
 * reference declares `schema_migrations` near the end of its body; creating it
 * first means a failed bootstrap still leaves an auditable record.
 */
export const SCHEMA_MIGRATIONS_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS threadline;

CREATE TABLE IF NOT EXISTS threadline.schema_migrations (
  id uuid PRIMARY KEY,
  store text NOT NULL CHECK (store IN ('postgres','falkor')),
  version integer NOT NULL CHECK (version > 0),
  checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store, version)
);
`;
