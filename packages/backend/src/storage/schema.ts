/**
 * SQL contract for the memory service: schema `threadline_memory`.
 *
 * Thirteen tables: twelve application tables plus the migration ledger. This is
 * a new schema with its own ledger and its own application role; the retired
 * owned-execution schema is neither read nor extended, and no legacy row is
 * converted.
 *
 * Design rules applied here:
 *
 * - every project-owned reference is composite `(tenant_id, project_id, id)` so
 *   a cross-tenant row cannot be inserted by accident;
 * - lifecycle and discriminant fields are explicit columns with CHECK
 *   constraints; JSON is reserved for bounded operation payloads;
 * - 64-bit sequences are `bigint` and cross JavaScript as decimal strings;
 * - every tenant table uses forced row-level security with transaction-local
 *   tenant context, on top of the explicit project checks the service performs;
 * - source bodies live in immutable files. The row is their catalog, and there
 *   is no second artifact table duplicating the same locations.
 */

export interface SqlMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

const COMMON_TENANT_TABLE_FOOTER = (table: string): string => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_fence ON ${table}
  USING (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);`;

const MIGRATION_1_STATEMENTS: readonly string[] = [
  // Tenants are fenced by their own identity: bootstrap writes a new tenant
  // inside a transaction whose tenant context is that same new id.
  `CREATE TABLE tenants (
     id uuid PRIMARY KEY,
     label text NOT NULL CHECK (length(label) BETWEEN 1 AND 256),
     state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','disabled')),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
   ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_fence ON tenants
     USING (id = nullif(current_setting('threadline.tenant_id', true), '')::uuid)
     WITH CHECK (id = nullif(current_setting('threadline.tenant_id', true), '')::uuid);`,

  `CREATE TABLE principals (
     tenant_id uuid NOT NULL REFERENCES tenants(id),
     id uuid NOT NULL,
     kind text NOT NULL CHECK (kind IN ('human','service')),
     display_label text NOT NULL CHECK (length(display_label) BETWEEN 1 AND 256),
     local_identity_ref text,
     state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, id),
     UNIQUE (tenant_id, local_identity_ref)
   )`,
  `CREATE TABLE projects (
     tenant_id uuid NOT NULL REFERENCES tenants(id),
     id uuid NOT NULL,
     label text NOT NULL CHECK (length(label) BETWEEN 1 AND 256),
     graph_key text NOT NULL UNIQUE CHECK (length(graph_key) BETWEEN 1 AND 256),
     graph_epoch uuid NOT NULL,
     schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
     privacy_revision bigint NOT NULL DEFAULT 0 CHECK (privacy_revision >= 0),
     policy_state text NOT NULL DEFAULT 'ready' CHECK (policy_state IN ('ready','changing','blocked')),
     retention_policy_version integer NOT NULL DEFAULT 1 CHECK (retention_policy_version >= 1),
     next_source_seq bigint NOT NULL DEFAULT 0 CHECK (next_source_seq >= 0),
     state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','disabled')),
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, id)
   )`,
  `CREATE TABLE project_grants (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     id uuid NOT NULL,
     principal_id uuid NOT NULL,
     role text NOT NULL CHECK (role IN ('owner','member','reader')),
     state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
     grant_revision bigint NOT NULL DEFAULT 0 CHECK (grant_revision >= 0),
     issued_at timestamptz NOT NULL DEFAULT now(),
     revoked_at timestamptz,
     PRIMARY KEY (tenant_id, project_id, id),
     UNIQUE (tenant_id, project_id, principal_id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     FOREIGN KEY (tenant_id, principal_id) REFERENCES principals(tenant_id, id)
   )`,
  `CREATE TABLE client_tokens (
     tenant_id uuid NOT NULL,
     id uuid NOT NULL,
     principal_id uuid NOT NULL,
     project_id uuid,
     kind text NOT NULL CHECK (kind IN ('human_admin','producer')),
     token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
     scopes text[] NOT NULL DEFAULT '{}',
     enrollment_id uuid,
     binding_generation integer NOT NULL DEFAULT 0 CHECK (binding_generation >= 0),
     native_session_id uuid,
     mcp_instance_id text,
     selection_digest text CHECK (selection_digest IS NULL OR selection_digest ~ '^[0-9a-f]{64}$'),
     state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
     revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
     created_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz,
     expires_at timestamptz NOT NULL,
     idle_expires_at timestamptz NOT NULL,
     revoked_at timestamptz,
     PRIMARY KEY (tenant_id, id),
     UNIQUE (tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, principal_id) REFERENCES principals(tenant_id, id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     -- A producer credential is always project-bound; only the local human
     -- administrator token may exist without a project.
     CHECK (kind <> 'producer' OR project_id IS NOT NULL)
   )`,
  // Token lookup happens before the tenant is known, so the hash is globally
  // unique and resolution runs through a narrow SECURITY DEFINER function.
  `CREATE UNIQUE INDEX client_tokens_hash_unique ON client_tokens (token_hash)`,
  `CREATE INDEX client_tokens_principal_active ON client_tokens (tenant_id, principal_id)
     WHERE state = 'active'`,

  `CREATE TABLE workspace_bindings (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     id uuid NOT NULL,
     approving_principal_id uuid NOT NULL,
     root_kind text NOT NULL CHECK (root_kind IN ('repository','worktree','directory')),
     canonical_root text NOT NULL CHECK (length(canonical_root) BETWEEN 1 AND 4096),
     root_fingerprint text NOT NULL CHECK (length(root_fingerprint) BETWEEN 1 AND 256),
     permitted_roots text[] NOT NULL DEFAULT '{}',
     state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
     binding_policy_revision integer NOT NULL DEFAULT 1 CHECK (binding_policy_revision >= 1),
     created_at timestamptz NOT NULL DEFAULT now(),
     revoked_at timestamptz,
     PRIMARY KEY (tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     FOREIGN KEY (tenant_id, approving_principal_id) REFERENCES principals(tenant_id, id)
   )`,
  `CREATE UNIQUE INDEX workspace_bindings_active_root
     ON workspace_bindings (tenant_id, canonical_root) WHERE state = 'active'`,

  `CREATE TABLE native_sessions (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     id uuid NOT NULL,
     enrollment_id uuid NOT NULL,
     binding_id uuid NOT NULL,
     binding_generation integer NOT NULL CHECK (binding_generation >= 0),
     principal_id uuid NOT NULL,
     harness text NOT NULL CHECK (harness IN ('codex')),
     harness_version text NOT NULL CHECK (length(harness_version) BETWEEN 1 AND 64),
     installation_id text,
     native_thread_ref text,
     parent_thread_ref text,
     instance_fingerprint text NOT NULL CHECK (length(instance_fingerprint) BETWEEN 1 AND 256),
     identity_precision text NOT NULL CHECK (identity_precision IN ('strong','provisional')),
     capture_policy_version integer NOT NULL DEFAULT 1 CHECK (capture_policy_version >= 1),
     capture_coverage text NOT NULL CHECK (capture_coverage IN ('unknown','partial','supported')),
     session_seq bigint NOT NULL DEFAULT 0 CHECK (session_seq >= 0),
     state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
     first_seen_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     FOREIGN KEY (tenant_id, project_id, binding_id)
       REFERENCES workspace_bindings(tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id, enrollment_id)
       REFERENCES client_tokens(tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, principal_id) REFERENCES principals(tenant_id, id)
   )`,
  // A strong native thread identity is unique within its project; a provisional
  // instance is unique by fingerprint so two concurrent roots cannot silently
  // claim the same native session.
  `CREATE UNIQUE INDEX native_sessions_thread
     ON native_sessions (tenant_id, project_id, native_thread_ref)
     WHERE native_thread_ref IS NOT NULL AND identity_precision = 'strong'`,
  `CREATE UNIQUE INDEX native_sessions_instance
     ON native_sessions (tenant_id, project_id, instance_fingerprint)`,
  `CREATE INDEX native_sessions_recent ON native_sessions (tenant_id, project_id, last_seen_at DESC)`,

  `CREATE TABLE sources (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     id uuid NOT NULL,
     delivery_id text NOT NULL CHECK (length(delivery_id) BETWEEN 1 AND 200),
     origin_key text NOT NULL CHECK (length(origin_key) BETWEEN 1 AND 512),
     origin_revision text NOT NULL CHECK (length(origin_revision) BETWEEN 1 AND 128),
     kind text NOT NULL,
     producer_principal_id uuid NOT NULL,
     producer_session_id uuid,
     native_turn_ref text,
     native_item_ref text,
     native_tool_ref text,
     native_order bigint CHECK (native_order IS NULL OR native_order >= 0),
     parent_origin_key text,
     session_seq bigint CHECK (session_seq IS NULL OR session_seq >= 0),
     project_seq bigint NOT NULL CHECK (project_seq >= 0),
     observed_at timestamptz NOT NULL,
     captured_at timestamptz NOT NULL DEFAULT now(),
     visibility text NOT NULL DEFAULT 'project' CHECK (visibility IN ('project','principal')),
     owner_principal_id uuid,
     digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
     byte_size bigint NOT NULL CHECK (byte_size >= 0),
     storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 512),
     media_type text NOT NULL DEFAULT 'application/octet-stream'
       CHECK (length(media_type) BETWEEN 1 AND 128),
     completeness text NOT NULL CHECK (completeness IN ('complete','partial','unknown','gap')),
     availability text NOT NULL DEFAULT 'available'
       CHECK (availability IN ('available','missing','deleted')),
     retention text NOT NULL DEFAULT 'raw_expiring'
       CHECK (retention IN ('raw_expiring','retained')),
     deletion_generation bigint NOT NULL DEFAULT 0 CHECK (deletion_generation >= 0),
     consent_version integer NOT NULL DEFAULT 1 CHECK (consent_version >= 1),
     gap_reason text,
     PRIMARY KEY (tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     FOREIGN KEY (tenant_id, producer_principal_id) REFERENCES principals(tenant_id, id),
     FOREIGN KEY (tenant_id, project_id, producer_session_id)
       REFERENCES native_sessions(tenant_id, project_id, id),
     CHECK ((visibility = 'principal') = (owner_principal_id IS NOT NULL)),
     CHECK (kind <> 'capture_gap' OR gap_reason IS NOT NULL)
   )`,
  `CREATE UNIQUE INDEX sources_origin
     ON sources (tenant_id, project_id, origin_key, origin_revision)`,
  `CREATE UNIQUE INDEX sources_project_seq ON sources (tenant_id, project_id, project_seq)`,
  `CREATE UNIQUE INDEX sources_delivery ON sources (tenant_id, project_id, delivery_id)`,
  `CREATE UNIQUE INDEX sources_session_seq
     ON sources (tenant_id, project_id, producer_session_id, session_seq)
     WHERE session_seq IS NOT NULL`,
  // The history page scans the project sequence directly; this index is the
  // measured path for it.
  `CREATE INDEX sources_history ON sources (tenant_id, project_id, project_seq)`,

  `CREATE TABLE source_links (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     parent_source_id uuid NOT NULL,
     child_source_id uuid NOT NULL,
     relation text NOT NULL CHECK (relation IN ('excerpt_of','depends_on','context_uses')),
     start_offset bigint CHECK (start_offset IS NULL OR start_offset >= 0),
     end_offset bigint CHECK (end_offset IS NULL OR end_offset >= 0),
     created_policy_version integer NOT NULL DEFAULT 1 CHECK (created_policy_version >= 1),
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, project_id, parent_source_id, child_source_id, relation),
     FOREIGN KEY (tenant_id, project_id, parent_source_id)
       REFERENCES sources(tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id, child_source_id)
       REFERENCES sources(tenant_id, project_id, id),
     CHECK (parent_source_id <> child_source_id),
     CHECK (start_offset IS NULL OR end_offset IS NULL OR end_offset >= start_offset)
   )`,
  `CREATE INDEX source_links_child ON source_links (tenant_id, project_id, child_source_id)`,

  `CREATE TABLE operations (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     id uuid NOT NULL,
     idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
     kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
     request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
     actor_principal_id uuid NOT NULL,
     actor_token_id uuid,
     native_session_id uuid,
     intent_source_id uuid,
     graph_epoch uuid NOT NULL,
     privacy_revision bigint NOT NULL CHECK (privacy_revision >= 0),
     expected_head_token text,
     expected_claim_token text,
     expected_task_revision text,
     payload jsonb NOT NULL DEFAULT '{}'::jsonb,
     state text NOT NULL DEFAULT 'pending'
       CHECK (state IN ('pending','leased','ambiguous','committed','rejected','cancelled')),
     lease_owner text,
     lease_token text,
     lease_expires_at timestamptz,
     attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
     next_attempt_at timestamptz NOT NULL DEFAULT now(),
     error_code text,
     error_detail text,
     receipt_graph_epoch uuid,
     receipt_event_seq bigint CHECK (receipt_event_seq IS NULL OR receipt_event_seq >= 0),
     receipt_outcome text,
     created_at timestamptz NOT NULL DEFAULT now(),
     settled_at timestamptz,
     PRIMARY KEY (tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     FOREIGN KEY (tenant_id, project_id, intent_source_id)
       REFERENCES sources(tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id, native_session_id)
       REFERENCES native_sessions(tenant_id, project_id, id),
     UNIQUE (tenant_id, project_id, idempotency_key),
     CHECK (state <> 'leased' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
     -- A committed operation always names where its graph commit landed.
     CHECK (state <> 'committed' OR receipt_event_seq IS NOT NULL)
   )`,
  `CREATE INDEX operations_claimable
     ON operations (tenant_id, project_id, next_attempt_at) WHERE state = 'pending'`,
  `CREATE INDEX operations_leased
     ON operations (lease_expires_at) WHERE state = 'leased'`,
  `CREATE INDEX operations_ambiguous
     ON operations (tenant_id, project_id, created_at) WHERE state = 'ambiguous'`,

  `CREATE TABLE context_occurrences (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     id uuid NOT NULL,
     manifest_source_id uuid NOT NULL,
     principal_id uuid NOT NULL,
     token_id uuid,
     native_session_id uuid,
     task_id uuid,
     boundary text,
     native_turn_ref text,
     packet_digest text NOT NULL CHECK (packet_digest ~ '^[0-9a-f]{64}$'),
     graph_epoch uuid NOT NULL,
     graph_head bigint NOT NULL CHECK (graph_head >= 0),
     privacy_revision bigint NOT NULL CHECK (privacy_revision >= 0),
     state text NOT NULL DEFAULT 'prepared'
       CHECK (state IN ('prepared','emitted','native_observed','unknown','refused')),
     nonce text,
     created_at timestamptz NOT NULL DEFAULT now(),
     emitted_at timestamptz,
     refusal_reason text,
     PRIMARY KEY (tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     FOREIGN KEY (tenant_id, project_id, manifest_source_id)
       REFERENCES sources(tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id, native_session_id)
       REFERENCES native_sessions(tenant_id, project_id, id)
   )`,
  `CREATE UNIQUE INDEX context_occurrences_nonce
     ON context_occurrences (tenant_id, project_id, nonce) WHERE nonce IS NOT NULL`,
  `CREATE INDEX context_occurrences_recent
     ON context_occurrences (tenant_id, project_id, created_at DESC)`,

  `CREATE TABLE jobs (
     tenant_id uuid NOT NULL,
     project_id uuid NOT NULL,
     id uuid NOT NULL,
     kind text NOT NULL CHECK (kind IN ('import','delete','export','retention')),
     request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
     actor_principal_id uuid NOT NULL,
     manifest_source_id uuid NOT NULL,
     selection_digest text NOT NULL CHECK (selection_digest ~ '^[0-9a-f]{64}$'),
     state text NOT NULL DEFAULT 'pending'
       CHECK (state IN ('pending','running','paused','completed','failed','cancelled')),
     stage text NOT NULL DEFAULT 'queued' CHECK (length(stage) BETWEEN 1 AND 64),
     cursor text,
     processed bigint NOT NULL DEFAULT 0 CHECK (processed >= 0),
     total bigint CHECK (total IS NULL OR total >= 0),
     lease_owner text,
     lease_expires_at timestamptz,
     attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
     error_code text,
     error_detail text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     settled_at timestamptz,
     PRIMARY KEY (tenant_id, project_id, id),
     FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
     FOREIGN KEY (tenant_id, project_id, manifest_source_id)
       REFERENCES sources(tenant_id, project_id, id),
     UNIQUE (tenant_id, project_id, request_key)
   )`,
  `CREATE INDEX jobs_pending ON jobs (state, updated_at) WHERE state IN ('pending','running')`,

  COMMON_TENANT_TABLE_FOOTER('principals'),
  COMMON_TENANT_TABLE_FOOTER('projects'),
  COMMON_TENANT_TABLE_FOOTER('project_grants'),
  COMMON_TENANT_TABLE_FOOTER('client_tokens'),
  COMMON_TENANT_TABLE_FOOTER('workspace_bindings'),
  COMMON_TENANT_TABLE_FOOTER('native_sessions'),
  COMMON_TENANT_TABLE_FOOTER('sources'),
  COMMON_TENANT_TABLE_FOOTER('source_links'),
  COMMON_TENANT_TABLE_FOOTER('operations'),
  COMMON_TENANT_TABLE_FOOTER('context_occurrences'),
  COMMON_TENANT_TABLE_FOOTER('jobs'),

  // Resolves a bearer credential to its tenant, principal, project scope and
  // graph routing before any tenant context exists. Narrow by construction: it
  // returns exactly the fields an authenticated call needs and nothing else.
  `CREATE FUNCTION token_lookup(p_token_hash text)
   RETURNS TABLE (
     token_id uuid,
     tenant_id uuid,
     principal_id uuid,
     principal_kind text,
     display_label text,
     project_id uuid,
     token_kind text,
     scopes text[],
     enrollment_id uuid,
     binding_generation integer,
     native_session_id uuid,
     mcp_instance_id text,
     expires_at timestamptz,
     idle_expires_at timestamptz,
     revoked_at timestamptz,
     project_state text,
     project_policy_state text,
     graph_key text,
     graph_epoch uuid,
     privacy_revision bigint,
     token_active boolean,
     principal_active boolean,
     grant_role text
   )
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = threadline_memory, pg_temp
   AS $$
     SELECT t.id, t.tenant_id, t.principal_id, p.kind, p.display_label,
            t.project_id, t.kind, t.scopes, t.enrollment_id, t.binding_generation,
            t.native_session_id, t.mcp_instance_id, t.expires_at, t.idle_expires_at,
            t.revoked_at, pr.state, pr.policy_state, pr.graph_key, pr.graph_epoch,
            pr.privacy_revision,
            (t.state = 'active') AS token_active,
            (p.state = 'active') AS principal_active,
            g.role
       FROM client_tokens t
       JOIN principals p ON p.tenant_id = t.tenant_id AND p.id = t.principal_id
       LEFT JOIN projects pr ON pr.tenant_id = t.tenant_id AND pr.id = t.project_id
       LEFT JOIN project_grants g
              ON g.tenant_id = t.tenant_id AND g.project_id = t.project_id
             AND g.principal_id = t.principal_id AND g.state = 'active'
      WHERE t.token_hash = p_token_hash
   $$`,
];

/**
 * Migration 2: the leased claim and backlog surfaces the commit worker needs.
 *
 * Row-level security is forced on `operations`, and the worker must find
 * claimable work before any tenant context exists (it learns the tenant from
 * the row it claims). These two functions are the entire cross-tenant surface:
 * a bounded, state-guarded lease update and an aggregate count. Neither accepts
 * a caller-supplied tenant or project.
 *
 * The claim returns the whole operation row here, including `payload`. Migration
 * 3 narrows it to the columns the worker actually reads; the privilege the
 * definer needs to cross the tenant fence without a payload is stated there.
 */
const MIGRATION_2_STATEMENTS: readonly string[] = [
  `CREATE FUNCTION claim_operations(
     p_limit integer,
     p_worker text,
     p_lease_token text,
     p_lease_seconds integer,
     p_kinds text[]
   )
   RETURNS SETOF threadline_memory.operations
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = threadline_memory, pg_temp
   AS $$
     UPDATE threadline_memory.operations o
        SET state = 'leased',
            lease_owner = p_worker,
            lease_token = p_lease_token,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempts = o.attempts + 1
       FROM (
         SELECT s.tenant_id, s.project_id, s.id
           FROM threadline_memory.operations s
          WHERE s.kind = ANY(p_kinds)
            AND s.next_attempt_at <= now()
            AND (s.state IN ('pending', 'ambiguous')
                 OR (s.state = 'leased' AND s.lease_expires_at IS NOT NULL
                     AND s.lease_expires_at <= now()))
          ORDER BY s.next_attempt_at ASC, s.created_at ASC, s.id ASC
          LIMIT p_limit
          FOR UPDATE SKIP LOCKED
       ) claimed
      WHERE (o.tenant_id, o.project_id, o.id)
            = (claimed.tenant_id, claimed.project_id, claimed.id)
      RETURNING o.*
   $$`,

  `CREATE FUNCTION operation_backlog()
   RETURNS TABLE (
     operation_state text,
     operation_count bigint,
     oldest_created_at timestamptz
   )
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = threadline_memory, pg_temp
   AS $$
     SELECT o.state, count(*), min(o.created_at)
       FROM threadline_memory.operations o
      WHERE o.state IN ('pending', 'leased', 'ambiguous')
      GROUP BY o.state
   $$`,

  // Records the graph receipt's own commit timestamp at settlement, so an
  // inspected operation reports when the graph effect happened rather than
  // inferring it from the SQL settlement clock.
  `ALTER TABLE operations ADD COLUMN receipt_committed_at timestamptz`,
];

/**
 * Migration 3: narrow the cross-tenant claim to the columns the worker reads.
 *
 * Migration 2's `claim_operations` returned the whole operation row
 * (`RETURNING o.*`), which includes `payload`. The worker never reads a payload,
 * so the privileged surface is reduced here to the facts the commit path needs:
 * routing, identity and lease bookkeeping. Returning less from the one function
 * that crosses the tenant barrier is the point of the change, so the column list
 * is explicit rather than a star.
 *
 * The function is dropped and recreated because a return type cannot be changed
 * in place; `grantToApplicationRole` re-grants EXECUTE on the new signature after
 * the migration loop. Both privileged functions require an owner that can bypass
 * forced row-level security to see any row at all — that requirement is verified
 * at setup and at startup rather than assumed.
 */
const MIGRATION_3_STATEMENTS: readonly string[] = [
  `DROP FUNCTION IF EXISTS threadline_memory.claim_operations(integer, text, text, integer, text[])`,

  `CREATE FUNCTION claim_operations(
     p_limit integer,
     p_worker text,
     p_lease_token text,
     p_lease_seconds integer,
     p_kinds text[]
   )
   RETURNS TABLE (
     tenant_id uuid,
     project_id uuid,
     id uuid,
     kind text,
     request_digest text,
     intent_source_id uuid,
     graph_epoch uuid,
     privacy_revision bigint,
     attempts integer,
     next_attempt_at timestamptz,
     created_at timestamptz
   )
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = threadline_memory, pg_temp
   AS $$
     UPDATE threadline_memory.operations o
        SET state = 'leased',
            lease_owner = p_worker,
            lease_token = p_lease_token,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempts = o.attempts + 1
        FROM (
          SELECT s.tenant_id, s.project_id, s.id
            FROM threadline_memory.operations s
           WHERE s.kind = ANY(p_kinds)
             AND s.next_attempt_at <= now()
             AND (s.state IN ('pending', 'ambiguous')
                  OR (s.state = 'leased' AND s.lease_expires_at IS NOT NULL
                      AND s.lease_expires_at <= now()))
           ORDER BY s.next_attempt_at ASC, s.created_at ASC, s.id ASC
           LIMIT p_limit
           FOR UPDATE SKIP LOCKED
        ) claimed
       WHERE (o.tenant_id, o.project_id, o.id)
             = (claimed.tenant_id, claimed.project_id, claimed.id)
       RETURNING o.tenant_id, o.project_id, o.id, o.kind, o.request_digest,
                 o.intent_source_id, o.graph_epoch, o.privacy_revision, o.attempts,
                 o.next_attempt_at, o.created_at
   $$`,
];

/**
 * Migration 4: intent identities for memory and task operations.
 *
 * A `source.append` intent names one source. The memory and task kinds name a
 * stable identity the intent concerns — the Memory, the MemoryVersion and the
 * Task it will create, accept, correct or require — and two guard tokens the
 * kind writes under (`expected_head_token`, `expected_task_revision`). Those
 * references belong in typed columns rather than JSON probes: the worker's
 * dependency diagnosis (is a prerequisite operation still pending?) is a
 * bounded, indexed lookup on the identity the dependent operation names.
 *
 * Content still never enters the operation row. A memory intent's content is
 * captured as a `memory_proposal` Source and referenced through
 * `intent_source_id`; these columns are identities only.
 *
 * The claim function is recreated with the same pattern as migration 3: the
 * return list is explicit, and `grantToApplicationRole` re-grants EXECUTE on
 * the new signature after the migration loop.
 */
const MIGRATION_4_STATEMENTS: readonly string[] = [
  `ALTER TABLE operations ADD COLUMN intent_memory_id uuid`,
  `ALTER TABLE operations ADD COLUMN intent_version_id uuid`,
  `ALTER TABLE operations ADD COLUMN intent_task_id uuid`,

  `CREATE INDEX operations_intent_memory
     ON operations (tenant_id, project_id, intent_memory_id) WHERE intent_memory_id IS NOT NULL`,
  `CREATE INDEX operations_intent_version
     ON operations (tenant_id, project_id, intent_version_id) WHERE intent_version_id IS NOT NULL`,
  `CREATE INDEX operations_intent_task
     ON operations (tenant_id, project_id, intent_task_id) WHERE intent_task_id IS NOT NULL`,

  `DROP FUNCTION IF EXISTS threadline_memory.claim_operations(integer, text, text, integer, text[])`,

  `CREATE FUNCTION claim_operations(
     p_limit integer,
     p_worker text,
     p_lease_token text,
     p_lease_seconds integer,
     p_kinds text[]
   )
   RETURNS TABLE (
     tenant_id uuid,
     project_id uuid,
     id uuid,
     kind text,
     request_digest text,
     intent_source_id uuid,
     intent_memory_id uuid,
     intent_version_id uuid,
     intent_task_id uuid,
     expected_head_token text,
     expected_task_revision text,
     graph_epoch uuid,
     privacy_revision bigint,
     attempts integer,
     next_attempt_at timestamptz,
     created_at timestamptz
   )
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = threadline_memory, pg_temp
   AS $$
     UPDATE threadline_memory.operations o
        SET state = 'leased',
            lease_owner = p_worker,
            lease_token = p_lease_token,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempts = o.attempts + 1
        FROM (
          SELECT s.tenant_id, s.project_id, s.id
            FROM threadline_memory.operations s
           WHERE s.kind = ANY(p_kinds)
             AND s.next_attempt_at <= now()
             AND (s.state IN ('pending', 'ambiguous')
                  OR (s.state = 'leased' AND s.lease_expires_at IS NOT NULL
                      AND s.lease_expires_at <= now()))
           ORDER BY s.next_attempt_at ASC, s.created_at ASC, s.id ASC
           LIMIT p_limit
           FOR UPDATE SKIP LOCKED
        ) claimed
       WHERE (o.tenant_id, o.project_id, o.id)
             = (claimed.tenant_id, claimed.project_id, claimed.id)
       RETURNING o.tenant_id, o.project_id, o.id, o.kind, o.request_digest,
                 o.intent_source_id, o.intent_memory_id, o.intent_version_id, o.intent_task_id,
                 o.expected_head_token, o.expected_task_revision,
                 o.graph_epoch, o.privacy_revision, o.attempts,
                 o.next_attempt_at, o.created_at
   $$`,
];

export const MEMORY_SQL_MIGRATIONS: readonly SqlMigration[] = [
  {
    version: 1,
    name: 'memory_core',
    statements: MIGRATION_1_STATEMENTS,
  },
  {
    version: 2,
    name: 'operation_claim',
    statements: MIGRATION_2_STATEMENTS,
  },
  {
    version: 3,
    name: 'narrow_operation_claim',
    statements: MIGRATION_3_STATEMENTS,
  },
  {
    version: 4,
    name: 'memory_task_operation_identities',
    statements: MIGRATION_4_STATEMENTS,
  },
];

export const LATEST_SQL_SCHEMA_VERSION = MEMORY_SQL_MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);
